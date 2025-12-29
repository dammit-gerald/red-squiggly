import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/word.dart';

class SupabaseService {
  final SupabaseClient _client = Supabase.instance.client;

  Future<List<Word>> getQuizWords(int count) async {
    final userId = _client.auth.currentUser?.id;
    
    if (userId == null) {
      // Unauthenticated: Fetch random words
      // Note: 'random' in SQL needs a function or client-side shuffle. 
      // We'll fetch a larger batch and shuffle client-side for simplicity.
      final response = await _client
          .from('words')
          .select()
          .limit(100); // Fetch up to 100 to shuffle from
      
      final List<Word> words = (response as List)
          .map((e) => Word.fromMap(e))
          .toList();
      
      words.shuffle();
      return words.take(count).toList();
    }

    // Authenticated: Prioritize non-mastered words
    // Fetch words with the user's progress
    final response = await _client
        .from('words')
        .select('*, user_progress!left(*)')
        .eq('user_progress.user_id', userId); // This filter might need adjustment for LEFT JOIN behavior in Supabase

    // Actually, Supabase filtering on a left joined table can be tricky (it becomes inner join if you filter).
    // Better to fetch words, and the join will be null if no progress. 
    // We want ALL words, so we shouldn't .eq on the join unless we want only practiced words.
    // Correct approach: fetch all words, join progress where user_id matches. 
    // Supabase JS/Dart SDK syntax for "User Progress for THIS user" in a join:
    // .select('*, user_progress(*)') and we'll have to filter the list client side or use a view/RPC for strict RLS.
    // But since RLS is set to "Users can see own progress", querying user_progress will only return THIS user's rows anyway!
    
    final responseWithRLS = await _client.from('words').select('*, user_progress(*)');

    List<Word> allWords = (responseWithRLS as List).map((e) => Word.fromMap(e)).toList();

    // Custom Sort Logic:
    // 1. Never seen (correct=0, incorrect=0) -> High priority
    // 2. High error rate (incorrect > correct) -> High priority
    // 3. Mastered (correct >> incorrect) -> Low priority
    
    allWords.sort((a, b) {
      // Calculate a "priority score". Lower is more urgent.
      
      bool aSeen = a.correctCount > 0 || a.incorrectCount > 0;
      bool bSeen = b.correctCount > 0 || b.incorrectCount > 0;

      // Unseen words come first
      if (!aSeen && bSeen) return -1;
      if (aSeen && !bSeen) return 1;

      // If both seen (or both unseen), sort by mastery
      // Mastery = correct - incorrect
      int masteryA = a.correctCount - a.incorrectCount;
      int masteryB = b.correctCount - b.incorrectCount;

      return masteryA.compareTo(masteryB);
    });

    // Add a bit of randomness to the top candidates so it's not identical order every time
    // Take top 3x count, shuffle, then take count.
    int poolSize = count * 3;
    if (poolSize > allWords.length) poolSize = allWords.length;
    
    final topPool = allWords.take(poolSize).toList();
    topPool.shuffle();
    
    return topPool.take(count).toList();
  }

  Future<void> updateProgress(String wordId, bool correct) async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) return;

    // We can't easily do an atomic increment without a custom Postgres function or checking existing.
    // We'll read-then-write for MVP.
    
    final existingData = await _client
        .from('user_progress')
        .select()
        .eq('user_id', userId)
        .eq('word_id', wordId)
        .maybeSingle();

    int currentCorrect = 0;
    int currentIncorrect = 0;
    String? rowId;

    if (existingData != null) {
      currentCorrect = existingData['correct_count'] as int;
      currentIncorrect = existingData['incorrect_count'] as int;
      rowId = existingData['id'] as String;
    }

    if (correct) {
      currentCorrect++;
    } else {
      currentIncorrect++;
    }

    final dataToUpsert = {
      'user_id': userId,
      'word_id': wordId,
      'correct_count': currentCorrect,
      'incorrect_count': currentIncorrect,
      'last_practiced_at': DateTime.now().toIso8601String(),
    };
    
    if (rowId != null) {
      dataToUpsert['id'] = rowId;
    }

    await _client.from('user_progress').upsert(dataToUpsert);
  }

  Future<Map<String, int>> getUserStats() async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) return {'total': 0, 'mastered': 0, 'learning': 0};

    final allWordsResponse = await _client.from('words').select('id');
    final totalCount = (allWordsResponse as List).length;

    final progressResponse = await _client
        .from('user_progress')
        .select()
        .eq('user_id', userId);

    final List progress = progressResponse as List;
    
    int mastered = 0;
    int learning = 0;

    for (var row in progress) {
      int correct = row['correct_count'] as int? ?? 0;
      int incorrect = row['incorrect_count'] as int? ?? 0;
      
      // Mastery logic: net score >= 3
      if (correct - incorrect >= 3) {
        mastered++;
      } else if (correct > 0 || incorrect > 0) {
        learning++;
      }
    }

    return {
      'total': totalCount,
      'mastered': mastered,
      'learning': learning,
    };
  }
}
