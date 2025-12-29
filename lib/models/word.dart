class Word {
  final String id;
  final String word;
  final int correctCount;
  final int incorrectCount;

  Word({
    required this.id,
    required this.word,
    this.correctCount = 0,
    this.incorrectCount = 0,
  });

  factory Word.fromMap(Map<String, dynamic> map) {
    // Check if user_progress is joined as a nested object or flat
    // Typically Supabase joins return a nested list or object if 1:1
    // For now, let's assume we flatten it or handle the specific query structure in the service.
    // Here we support flat structure if the query alias fields, or basic defaults.
    
    // Example: { "id": "...", "word": "cat", "user_progress": [ { "correct_count": 5, "incorrect_count": 0 } ] }
    
    int correct = 0;
    int incorrect = 0;

    if (map.containsKey('user_progress') && map['user_progress'] != null) {
      final progressList = map['user_progress'] as List;
      if (progressList.isNotEmpty) {
        correct = progressList[0]['correct_count'] as int? ?? 0;
        incorrect = progressList[0]['incorrect_count'] as int? ?? 0;
      }
    }

    return Word(
      id: map['id'] as String,
      word: map['word'] as String,
      correctCount: correct,
      incorrectCount: incorrect,
    );
  }
}
