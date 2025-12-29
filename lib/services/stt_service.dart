import 'package:speech_to_text/speech_to_text.dart';

class SttService {
  final SpeechToText _speechToText = SpeechToText();
  bool _isAvailable = false;

  Future<bool> init() async {
    try {
      _isAvailable = await _speechToText.initialize(
        onError: (val) => print('STT Error: $val'),
        onStatus: (val) => print('STT Status: $val'),
      );
    } catch (e) {
      print("STT Init Error: $e");
      _isAvailable = false;
    }
    return _isAvailable;
  }

  Future<void> listen({required Function(String) onResult}) async {
    if (!_isAvailable) {
        print("STT not available");
        return;
    }
    
    await _speechToText.listen(
      onResult: (result) {
        onResult(result.recognizedWords);
      },
      localeId: "en_US",
      cancelOnError: true,
      partialResults: true,
      pauseFor: const Duration(seconds: 5),
      listenFor: const Duration(seconds: 60),
    );
  }

  Future<void> stop() async {
    await _speechToText.stop();
  }
  
  bool get isListening => _speechToText.isListening;
}
