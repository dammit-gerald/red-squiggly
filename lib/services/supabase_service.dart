import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/word.dart';

class SupabaseService {
  final SupabaseClient _client = Supabase.instance.client;

  Future<List<String>> getLevels() async {
    final Set<String> levels = {};
    int offset = 0;
    const int limit = 1000;
    bool moreRows = true;

    while (moreRows) {
      final response = await _client
          .from('words')
          .select('level')
          .range(offset, offset + limit - 1); // range is inclusive
      
      final List<dynamic> rows = response as List;
      if (rows.isEmpty) {
        moreRows = false;
      } else {
        levels.addAll(rows.map((r) => r['level'] as String));
        if (rows.length < limit) {
          moreRows = false;
        } else {
          offset += limit;
        }
      }
    }
    
    final sortedLevels = levels.toList();
    sortedLevels.sort();
    return sortedLevels;
  }

  Future<List<Word>> getQuizWords(int count, List<String> levels) async {
    final userId = _client.auth.currentUser?.id;
    
    // Base query
    var query = _client.from('words').select('*, user_progress(*)');
    
    if (levels.isNotEmpty) {
      query = query.filter('level', 'in', '(${levels.map((e) => "\"$e\"").join(',')})');
    }
    
    final responseWithRLS = await query;

    List<Word> allWords = (responseWithRLS as List).map((e) => Word.fromMap(e)).toList();

    if (userId == null) {
        // Unauthenticated: Just shuffle and return
        allWords.shuffle();
        return allWords.take(count).toList();
    }

    // Authenticated: Prioritize non-mastered words
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
