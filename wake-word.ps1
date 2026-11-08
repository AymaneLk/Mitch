param([switch]$SelfTest, [switch]$Probe, [string]$WaveFile)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -ReferencedAssemblies @([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location, 'System.Core') -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text.RegularExpressions;

public static class MitchWakeWord {
  static readonly string[] Greetings = { "hi", "hey", "hello", "hey there", "hello there", "good morning", "good afternoon", "good evening", "good night", "okay", "ok", "yo", "bonjour", "bonsoir", "salut", "coucou", "salam", "salam alaykoum", "a" };
  static RecognizerInfo Installed() {
    var all = SpeechRecognitionEngine.InstalledRecognizers();
    var selected = all.FirstOrDefault(r => r.Culture.Name == "en-US") ?? all.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "en") ?? all.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "fr");
    if (selected == null) throw new InvalidOperationException("Install an English or French Windows speech recognition language to enable Hey Mitch.");
    return selected;
  }
  public static bool IsWakePhrase(string text) {
    var normalized = Regex.Replace((text ?? "").ToLowerInvariant(), @"[^\p{L}\p{N}\s]", " ");
    normalized = Regex.Replace(normalized, @"\s+", " ").Trim();
    if (normalized == "mitch") return true;
    return Greetings.Any(g => normalized == g + " mitch");
  }
  static SpeechRecognitionEngine Create() {
    var recognizer = new SpeechRecognitionEngine(Installed());
    var builder = new GrammarBuilder { Culture = recognizer.RecognizerInfo.Culture };
    builder.Append(new Choices(new[] { "Mitch" }.Concat(Greetings.Select(g => g + " Mitch")).ToArray()));
    var grammar = new Grammar(builder) { Name = "mitch-wake" };
    recognizer.LoadGrammar(grammar);
    // An ordinary dictation competitor prevents unrelated speech from always
    // being forced into our small wake grammar. Nothing is logged or retained.
    recognizer.LoadGrammar(new DictationGrammar { Name = "other-speech" });
    recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(180);
    recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(250);
    return recognizer;
  }
  static bool Accepted(RecognitionResult result) {
    return result != null && result.Confidence >= 0.72f && IsWakePhrase(result.Text);
  }
  static void Emit(string json) { Console.WriteLine(json); Console.Out.Flush(); }
  public static void Run(bool probe, string waveFile) {
    bool woke = false; float confidence = 0; string culture;
    using (var recognizer = Create()) {
      culture = recognizer.RecognizerInfo.Culture.Name;
      if (String.IsNullOrEmpty(waveFile)) recognizer.SetInputToDefaultAudioDevice(); else recognizer.SetInputToWaveFile(waveFile);
      using (var done = new ManualResetEvent(false))
      using (var stopped = new ManualResetEvent(false)) {
        Action finish = () => { try { done.Set(); } catch(ObjectDisposedException) {} };
        recognizer.SpeechRecognized += (sender, args) => {
          if (probe || !Accepted(args.Result)) return;
          confidence = args.Result.Confidence; woke = true; finish();
        };
        recognizer.RecognizeCompleted += (sender, args) => { try { stopped.Set(); } catch(ObjectDisposedException) {} if (args.Error != null || !String.IsNullOrEmpty(waveFile)) finish(); };
        // Parent exit closes stdin. No helper may outlive the owning application.
        if (!probe) Task.Run(() => { try { while (Console.ReadLine() != null) {} } catch {} finish(); });
        recognizer.RecognizeAsync(RecognizeMode.Multiple);
        Emit("{\"event\":\"ready\",\"culture\":\"" + culture + "\"}");
        using (var timer = probe ? new Timer(state => finish(), null, 500, Timeout.Infinite) : null) {
          done.WaitOne();
          if (!stopped.WaitOne(0)) recognizer.RecognizeAsyncCancel();
          if (!stopped.WaitOne(3000)) throw new TimeoutException("Windows did not release the wake microphone in time.");
        }
      }
      // Dispose releases the input after RecognizeCompleted. SetInputToNull
      // during asynchronous cancellation can throw while SAPI is still active.
    }
    // Release the microphone BEFORE asking the renderer to start WebRTC.
    if (woke) Emit("{\"event\":\"wake\",\"confidence\":" + confidence.ToString(CultureInfo.InvariantCulture) + "}");
  }
  public static void SelfTest() {
    var phrases = new[] { "Mitch", "Hi Mitch", "Good morning Mitch", "Hey Mitch", "Hello Mitch", "Good evening Mitch", "Good morning", "Switch the light", "I was talking about Mitch", "The weather is nice" };
    int failures = 0;
    using (var recognizer = Create())
    using (var voice = new SpeechSynthesizer()) {
      var english = voice.GetInstalledVoices().FirstOrDefault(v => v.Enabled && v.VoiceInfo.Culture.Name == "en-US");
      if (english != null) voice.SelectVoice(english.VoiceInfo.Name);
      voice.Rate = -2;
      foreach (var phrase in phrases) {
        using (var wave = new MemoryStream()) {
          var prompt = new PromptBuilder(); prompt.AppendBreak(TimeSpan.FromMilliseconds(250)); prompt.AppendText(phrase); prompt.AppendBreak(TimeSpan.FromMilliseconds(600));
          voice.SetOutputToWaveStream(wave); voice.Speak(prompt); voice.SetOutputToNull(); wave.Position = 0;
          recognizer.SetInputToWaveStream(wave);
          var result = recognizer.Recognize(TimeSpan.FromSeconds(6));
          bool accepted = Accepted(result), expected = IsWakePhrase(phrase);
          Emit("{\"phrase\":\"" + phrase + "\",\"expected\":" + expected.ToString().ToLowerInvariant() + ",\"accepted\":" + accepted.ToString().ToLowerInvariant() + ",\"confidence\":" + (result == null ? "0" : result.Confidence.ToString(CultureInfo.InvariantCulture)) + "}");
          recognizer.SetInputToNull();
          if (accepted != expected) failures++;
        }
      }
      if (failures > 0) throw new InvalidOperationException("Wake recognition self-test failures: " + failures);
      Emit("{\"event\":\"self-test-passed\",\"culture\":\"" + recognizer.RecognizerInfo.Culture.Name + "\"}");
    }
  }
}
'@
  if ($SelfTest) { [MitchWakeWord]::SelfTest() } else { [MitchWakeWord]::Run([bool]$Probe, $WaveFile) }
} catch {
  @{event='error';message=$_.Exception.GetBaseException().Message} | ConvertTo-Json -Compress
  exit 1
}
