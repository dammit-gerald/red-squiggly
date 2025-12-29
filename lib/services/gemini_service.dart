import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

class GeminiService {
  late final GenerativeModel _model;
  
  GeminiService() {
    final apiKey = dotenv.env['GEMINI_API_KEY'];
    if (apiKey == null) {
      // In production, might want to handle this gracefully
      throw Exception('GEMINI_API_KEY not found in .env');
    }
    // Using gemini-2.5-flash-lite as requested.
    _model = GenerativeModel(model: 'gemini-2.5-flash-lite', apiKey: apiKey);
  }

  Future<String> getDefinition(String word) async {
    final prompt = 'Define the word "$word" for a spelling bee quiz for a child. Keep it concise (1 short sentence). DO NOT use the word itself or any part of the word in the definition.';
    final response = await _model.generateContent([Content.text(prompt)]);
    return response.text?.trim() ?? 'Definition not available.';
  }

  Future<String> getOrigin(String word) async {
     final prompt = 'What is the language of origin for the word "$word"? Just state the language(s) concisely.';
     final response = await _model.generateContent([Content.text(prompt)]);
     return response.text?.trim() ?? 'Origin not available.';
  }

  Future<String> getSentence(String word) async {
    final prompt = 'Use the word "$word" in a simple sentence suitable for a child. IMPORTANT: Replace the word "$word" with "_____" (underscores) in the sentence so the spelling remains a secret.';
    final response = await _model.generateContent([Content.text(prompt)]);
    return response.text?.trim() ?? 'Sentence not available.';
  }
}
