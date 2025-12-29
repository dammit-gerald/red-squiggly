import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

class TtsService {
  final FlutterTts _flutterTts = FlutterTts();

  Future<void> init() async {
    await _flutterTts.setLanguage("en-US");
    await _flutterTts.setSpeechRate(0.5); 
    await _flutterTts.setVolume(1.0);
    await _flutterTts.setPitch(1.0);
    await _flutterTts.awaitSpeakCompletion(true);
  }

  Future<void> speak(String text) async {
    await _flutterTts.speak(text);
  }
  
  Future<void> stop() async {
      await _flutterTts.stop();
  }

  // New methods for Voice Selection
  Future<List<Map<String, dynamic>>> getVoices() async {
    try {
      final voices = await _flutterTts.getVoices;
      if (voices == null) return [];
      
      final List<Map<String, dynamic>> typedVoices = List<Map<String, dynamic>>.from(voices);
      return typedVoices.where((v) {
        final locale = v['locale'].toString().toLowerCase();
        return locale.contains('en');
      }).toList();
    } catch (e) {
      debugPrint("Error getting voices: $e");
      return [];
    }
  }

  Future<void> setVoice(Map<String, dynamic> voice) async {
    try {
      // Cast the Map<String, dynamic> to Map<String, String> as required by flutter_tts
      final Map<String, String> voiceMap = voice.map((key, value) => MapEntry(key, value.toString()));
      await _flutterTts.setVoice(voiceMap);
    } catch (e) {
      debugPrint("Error setting voice: $e");
    }
  }
}
