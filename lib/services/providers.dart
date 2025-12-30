import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'supabase_service.dart';
import 'gemini_service.dart';
import 'tts_service.dart';

final supabaseServiceProvider = Provider((ref) => SupabaseService());
final geminiServiceProvider = Provider((ref) => GeminiService());
final ttsServiceProvider = Provider((ref) => TtsService());
