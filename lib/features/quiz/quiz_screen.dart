import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'quiz_provider.dart';

class QuizScreen extends ConsumerStatefulWidget {
  final int quizLength;
  const QuizScreen({super.key, required this.quizLength});

  @override
  ConsumerState<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends ConsumerState<QuizScreen> {
  final TextEditingController _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Load quiz on init
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(quizProvider.notifier).loadQuiz(widget.quizLength);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(quizProvider);
    final notifier = ref.read(quizProvider.notifier);

    // Keep controller in sync with state if voice updates it
    if (_controller.text != state.userSpelling && state.phase != QuizPhase.feedback) {
        _controller.text = state.userSpelling;
        _controller.selection = TextSelection.fromPosition(TextPosition(offset: _controller.text.length));
    }

    if (state.status == QuizStatus.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (state.status == QuizStatus.summary) {
      return _buildSummary(context, state);
    }

    // Main Quiz Interface
    final currentWord = state.currentWord;
    if (currentWord == null) return const Scaffold(body: Center(child: Text('Error: No word loaded.')));

    final isListening = state.phase == QuizPhase.listening;
    final isFeedback = state.phase == QuizPhase.feedback;
    
    // Calculate progress
    final progress = (state.currentIndex + 1) / state.words.length;

    return Scaffold(
      appBar: AppBar(
        title: Text('Word ${state.currentIndex + 1} of ${state.words.length}'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(value: progress),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 1. The Word (Hidden or Revealed)
            Container(
              height: 150,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isFeedback 
                    ? (state.results[currentWord.id] == true ? Colors.green.shade100 : Colors.red.shade100) 
                    : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(20),
              ),
              child: isFeedback 
                ? Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        currentWord.word, 
                        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold)
                      ).animate().fadeIn().scale(),
                      if (state.results[currentWord.id] == false)
                         Text(
                          'You spelled: ${state.userSpelling}',
                          style: const TextStyle(fontSize: 18, color: Colors.red),
                        ),
                    ],
                  )
                : Icon(Icons.music_note, size: 60, color: Colors.grey.shade400)
                    .animate(onPlay: (c) => c.repeat(reverse: true))
                    .scaleXY(end: 1.1, duration: 1.seconds),
            ),
            const SizedBox(height: 20),
            
            // 2. Actions (Speak, Hints)
            if (!isFeedback) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    IconButton.filled(
                      onPressed: notifier.speakWord,
                      icon: const Icon(Icons.volume_up),
                      iconSize: 32,
                      tooltip: "Listen Again",
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 10,
                  children: [
                    ActionChip(
                      avatar: const Icon(Icons.menu_book),
                      label: const Text('Define'),
                      onPressed: () => notifier.requestHint('definition'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.public),
                      label: const Text('Origin'),
                      onPressed: () => notifier.requestHint('origin'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.chat_bubble),
                      label: const Text('Sentence'),
                      onPressed: () => notifier.requestHint('sentence'),
                    ),
                  ],
                ),
                if (state.currentHint != null)
                   Padding(
                     padding: const EdgeInsets.symmetric(vertical: 10),
                     child: Container(
                       padding: const EdgeInsets.all(12),
                       decoration: BoxDecoration(
                         color: Colors.blue.shade50,
                         borderRadius: BorderRadius.circular(10),
                         border: Border.all(color: Colors.blue.shade200),
                       ),
                       child: Text(
                         state.currentHint!, 
                         textAlign: TextAlign.center,
                         style: TextStyle(color: Colors.blue.shade900),
                       ),
                     ).animate().fadeIn(),
                   ),
            ],

            const SizedBox(height: 30),

            // 3. Input
            if (!isFeedback) ...[
                TextField(
                  controller: _controller,
                  decoration: const InputDecoration(
                    labelText: 'Spell it here...',
                    border: OutlineInputBorder(),
                    helperText: "Type or use the mic",
                  ),
                  onChanged: (val) => notifier.updateSpelling(val),
                  readOnly: isListening, // Prevent typing while listening
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: FloatingActionButton.large(
                        heroTag: 'mic',
                        onPressed: isListening ? notifier.stopListening : notifier.startListening,
                        backgroundColor: isListening ? Colors.red : Theme.of(context).colorScheme.primaryContainer,
                        child: Icon(isListening ? Icons.mic_off : Icons.mic),
                      ),
                    ),
                    const SizedBox(width: 20),
                    Expanded(
                      child: FloatingActionButton.large(
                        heroTag: 'submit',
                        onPressed: state.userSpelling.isNotEmpty ? notifier.submitAnswer : null,
                        backgroundColor: Colors.green,
                        child: const Icon(Icons.check, color: Colors.white),
                      ),
                    ),
                  ],
                ),
            ] else ...[
                // Feedback actions
                SizedBox(
                  width: double.infinity,
                  height: 60,
                  child: FilledButton(
                    onPressed: notifier.nextWord,
                    child: const Text('Next Word', style: TextStyle(fontSize: 20)),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildSummary(BuildContext context, QuizState state) {
    int correct = state.results.values.where((v) => v).length;
    int total = state.words.length;
    
    return Scaffold(
      appBar: AppBar(title: const Text('Quiz Complete!')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Center(
            child: Column(
              children: [
                const Text('Score', style: TextStyle(fontSize: 24)),
                Text('$correct / $total', style: const TextStyle(fontSize: 60, fontWeight: FontWeight.bold, color: Colors.blue)),
              ],
            ),
          ),
          const SizedBox(height: 30),
          const Text('Results:', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          ...state.words.map((word) {
            final isCorrect = state.results[word.id] ?? false;
            return Card(
              color: isCorrect ? Colors.green.shade50 : Colors.red.shade50,
              child: ListTile(
                title: Text(word.word, style: const TextStyle(fontWeight: FontWeight.bold)),
                leading: Icon(
                    isCorrect ? Icons.check_circle : Icons.cancel,
                    color: isCorrect ? Colors.green : Colors.red,
                ),
              ),
            );
          }),
          const SizedBox(height: 40),
          FilledButton(
            onPressed: () => context.go('/'),
            child: const Text('Back to Home'),
          ),
        ],
      ),
    );
  }
}