import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/providers.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  List<Map<String, dynamic>> _voices = [];
  Map<String, dynamic>? _selectedVoice;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadVoices();
  }

  Future<void> _loadVoices() async {
    final tts = ref.read(ttsServiceProvider);
    await tts.init(); // Ensure init is called
    final voices = await tts.getVoices();
    setState(() {
      _voices = voices;
      _isLoading = false;
      // Optionally try to find current system default or previously selected one
      // For now, we leave it null until user picks one
    });
  }

  Future<void> _testVoice(Map<String, dynamic> voice) async {
    final tts = ref.read(ttsServiceProvider);
    await tts.setVoice(voice);
    await tts.speak("Hello, I am Red Squiggly. Ready to spell?");
    setState(() {
      _selectedVoice = voice;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('Select Voice', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              if (_voices.isEmpty)
                const Text('No compatible voices found on this device.')
              else
                ..._voices.map((voice) {
                  final name = voice['name'] ?? 'Unknown';
                  final locale = voice['locale'] ?? 'Unknown';
                  final isSelected = _selectedVoice == voice;
                  
                  return Card(
                    color: isSelected ? Colors.red.shade50 : null,
                    child: ListTile(
                      title: Text(name),
                      subtitle: Text(locale),
                      trailing: IconButton(
                        icon: const Icon(Icons.volume_up),
                        onPressed: () => _testVoice(voice),
                      ),
                      onTap: () => _testVoice(voice),
                      selected: isSelected,
                    ),
                  );
                }),
            ],
          ),
    );
  }
}
