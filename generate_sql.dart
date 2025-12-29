import 'dart:io';

void main() {
  final file = File('wordlist.csv');
  if (!file.existsSync()) {
    stdout.writeln('Error: wordlist.csv not found.');
    return;
  }
  
  final lines = file.readAsLinesSync();
  final buffer = StringBuffer();
  
  buffer.writeln('BEGIN;');
  
  buffer.writeln('\n-- 1. Add level column');
  buffer.writeln('ALTER TABLE public.words ADD COLUMN IF NOT EXISTS level text;');
  
  buffer.writeln('\n-- 2. Clean out old data');
  buffer.writeln('TRUNCATE TABLE public.user_progress CASCADE;');
  buffer.writeln('TRUNCATE TABLE public.words CASCADE;');
  
  buffer.writeln('\n-- 3. Insert new words (deduplicated)');
  buffer.writeln('INSERT INTO public.words (level, word) VALUES');
  
  final Set<String> seenWords = {};
  final List<String> valuesToInsert = [];

  // Skip header
  for (int i = 1; i < lines.length; i++) {
    final line = lines[i].trim();
    if (line.isEmpty) continue;
    
    final parts = line.split(',');
    if (parts.length >= 2) {
      final level = parts[0].trim();
      final word = parts[1].trim();
      
      if (seenWords.contains(word.toLowerCase())) continue;
      seenWords.add(word.toLowerCase());

      final escapedLevel = level.replaceAll("'", "''");
      final escapedWord = word.replaceAll("'", "''");
      valuesToInsert.add("('$escapedLevel', '$escapedWord')");
    }
  }
  
  for (int i = 0; i < valuesToInsert.length; i++) {
    buffer.write(valuesToInsert[i]);
    if (i < valuesToInsert.length - 1) {
      buffer.writeln(',');
    } else {
      buffer.writeln(';');
    }
  }

  buffer.writeln('\n-- 4. Enforce NOT NULL on level');
  buffer.writeln('ALTER TABLE public.words ALTER COLUMN level SET NOT NULL;');
  
  buffer.writeln('\nCOMMIT;');
  
  File('update_words.sql').writeAsStringSync(buffer.toString());
  stdout.writeln('Refined update_words.sql generated successfully (${seenWords.length} unique words).');
}
