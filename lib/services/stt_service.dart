import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';

class SttService {
  final SpeechToText _speechToText = SpeechToText();
  bool _isAvailable = false;

  Future<bool> init() async {
    try {
      _isAvailable = await _speechToText.initialize(
        onError: (val) => debugPrint('STT Error: $val'),
        onStatus: (val) => debugPrint('STT Status: $val'),
      );
    } catch (e) {
      debugPrint("STT Init Error: $e");
      _isAvailable = false;
    }
    return _isAvailable;
  }

  Future<void> listen({required Function(String) onResult}) async {
    if (!_isAvailable) {
        debugPrint("STT not available");
        return;
    }
    
    await _speechToText.listen(
      onResult: (result) {
        onResult(result.recognizedWords);
      },
      localeId: "en_US",
      listenOptions: SpeechListenOptions(
        cancelOnError: true,
        partialResults: true,
      ),
      pauseFor: const Duration(minutes: 2),
      listenFor: const Duration(minutes: 2),
    );
  }

  Future<void> stop() async {
    await _speechToText.stop();
  }
  
  bool get isListening => _speechToText.isListening;
}
