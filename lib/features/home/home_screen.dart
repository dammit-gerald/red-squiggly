import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../services/providers.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _quizLength = 10;
  final _supabase = Supabase.instance.client;

  @override
  Widget build(BuildContext context) {
    final user = _supabase.auth.currentUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Red Squiggly', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => context.push('/settings'),
          ),
          if (user != null)
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () async {
                await _supabase.auth.signOut();
                setState(() {});
              },
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(height: 20),
              const Icon(Icons.spellcheck, size: 80, color: Colors.redAccent),
              const SizedBox(height: 20),
              const Text('Spelling Bee Time!', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              
              if (user != null) ...[
                const SizedBox(height: 30),
                _buildStatsCard(),
              ],
              
              const SizedBox(height: 40),
              const Text('How many words?', style: TextStyle(fontSize: 18)),
              const SizedBox(height: 10),
              Slider(
                value: _quizLength.toDouble(),
                min: 5,
                max: 20,
                divisions: 3,
                label: _quizLength.toString(),
                onChanged: (val) => setState(() => _quizLength = val.toInt()),
              ),
               Text('$_quizLength Words', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.redAccent)),
              const SizedBox(height: 60),
              FilledButton.icon(
                onPressed: () => context.push('/quiz', extra: _quizLength),
                icon: const Icon(Icons.play_arrow),
                label: const Text('Start Quiz', style: TextStyle(fontSize: 20)),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 50, vertical: 20),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15))
                ),
              ),
              const SizedBox(height: 20),
              if (user == null)
                TextButton.icon(
                  onPressed: () => context.push('/auth'), 
                  icon: const Icon(Icons.person),
                  label: const Text('Login to track progress')
                )
              else
                Text('Logged in as ${user.email}', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatsCard() {
    return FutureBuilder(
      future: ref.read(supabaseServiceProvider).getUserStats(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final stats = snapshot.data as Map<String, int>;
        
        return Card(
          elevation: 0,
          color: Colors.red.shade50,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          child: Padding(
            padding: const EdgeInsets.all(20.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatItem('Mastered', stats['mastered'] ?? 0, Colors.green),
                _buildStatItem('Learning', stats['learning'] ?? 0, Colors.orange),
                _buildStatItem('Total', stats['total'] ?? 0, Colors.blue),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildStatItem(String label, int value, Color color) {
    return Column(
      children: [
        Text(value.toString(), style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54)),
      ],
    );
  }
}
