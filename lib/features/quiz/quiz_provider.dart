import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/word.dart';
import '../../services/providers.dart';

enum QuizStatus { loading, ready, inProgress, summary }
enum QuizPhase { waiting, listening, processing, feedback }

class QuizState {
  final QuizStatus status;
  final QuizPhase phase;
  final List<Word> words;
  final int currentIndex;
  final String userSpelling;
  final Map<String, bool> results; // wordId -> isCorrect
  final String? currentHint; // To display hint text

  QuizState({
    this.status = QuizStatus.loading,
    this.phase = QuizPhase.waiting,
    this.words = const [],
    this.currentIndex = 0,
    this.userSpelling = '',
    this.results = const {},
    this.currentHint,
  });

  QuizState copyWith({
    QuizStatus? status,
    QuizPhase? phase,
    List<Word>? words,
    int? currentIndex,
    String? userSpelling,
    Map<String, bool>? results,
    String? currentHint,
    bool forceClearHint = false,
  }) {
    return QuizState(
      status: status ?? this.status,
      phase: phase ?? this.phase,
      words: words ?? this.words,
      currentIndex: currentIndex ?? this.currentIndex,
      userSpelling: userSpelling ?? this.userSpelling,
      results: results ?? this.results,
      currentHint: forceClearHint ? null : (currentHint ?? this.currentHint),
    );
  }
  
  Word? get currentWord => words.isNotEmpty && currentIndex < words.length ? words[currentIndex] : null;
}

class QuizNotifier extends Notifier<QuizState> {
  @override
  QuizState build() {
    return QuizState();
  }

  Future<void> loadQuiz(int count) async {
    state = state.copyWith(status: QuizStatus.loading);
    try {
      final words = await ref.read(supabaseServiceProvider).getQuizWords(count);
      state = state.copyWith(
        status: QuizStatus.ready, 
        words: words,
        currentIndex: 0,
        results: {},
        phase: QuizPhase.waiting,
        userSpelling: '',
        forceClearHint: true,
      );
      // Auto-start first word? Maybe wait for user.
      if (words.isNotEmpty) {
          _startWord();
      }
    } catch (e) {
      print("Error loading quiz: $e");
    }
  }

  Future<void> _startWord() async {
    state = state.copyWith(phase: QuizPhase.waiting, userSpelling: '', forceClearHint: true);
    await speakWord();
  }

  Future<void> speakWord() async {
     final word = state.currentWord;
     if (word == null) return;
     await ref.read(ttsServiceProvider).speak(word.word);
  }

  Future<void> startListening() async {
    state = state.copyWith(phase: QuizPhase.listening, userSpelling: '');
    final stt = ref.read(sttServiceProvider);
    
    await stt.init();
    
    if (stt.isListening) {
        await stt.stop();
    }
    
    await stt.listen(onResult: (text) {
        state = state.copyWith(userSpelling: text);
    });
  }
  
  Future<void> stopListening() async {
      await ref.read(sttServiceProvider).stop();
      state = state.copyWith(phase: QuizPhase.waiting);
  }

  void updateSpelling(String value) {
      state = state.copyWith(userSpelling: value);
  }

  Future<void> submitAnswer() async {
    final word = state.currentWord;
    if (word == null) return;

    final input = state.userSpelling.replaceAll(' ', '').replaceAll('-', '').toLowerCase();
    final target = word.word.toLowerCase();
    
    final isCorrect = input == target;
    
    final newResults = Map<String, bool>.from(state.results);
    newResults[word.id] = isCorrect;
    
    state = state.copyWith(
        phase: QuizPhase.feedback,
        results: newResults,
    );
    
    ref.read(supabaseServiceProvider).updateProgress(word.id, isCorrect);
  }

  Future<void> nextWord() async {
    if (state.currentIndex < state.words.length - 1) {
      state = state.copyWith(currentIndex: state.currentIndex + 1);
      _startWord();
    } else {
      state = state.copyWith(status: QuizStatus.summary);
    }
  }

  Future<void> requestHint(String type) async {
    final word = state.currentWord;
    if (word == null) return;

    state = state.copyWith(currentHint: "Thinking...");
    
    String hint = "";
    final gemini = ref.read(geminiServiceProvider);
    
    try {
        if (type == 'definition') {
          hint = await gemini.getDefinition(word.word);
        } else if (type == 'origin') {
          hint = await gemini.getOrigin(word.word);
        } else if (type == 'sentence') {
          hint = await gemini.getSentence(word.word);
        }
    } catch (e) {
        print("Gemini Error: $e");
        hint = "Couldn't get hint. Check console.";
    }

    state = state.copyWith(currentHint: hint);
    await ref.read(ttsServiceProvider).speak(hint);
  }
}

final quizProvider = NotifierProvider<QuizNotifier, QuizState>(() {
  return QuizNotifier();
});