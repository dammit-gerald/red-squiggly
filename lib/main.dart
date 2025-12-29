import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';
import 'features/home/home_screen.dart';
import 'features/quiz/quiz_screen.dart';
import 'features/auth/auth_screen.dart';
import 'features/settings/settings_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  try {
    await dotenv.load(fileName: ".env");
  } catch (e) {
    print("Error loading .env: $e");
  }
  
  final supabaseUrl = dotenv.env['SUPABASE_URL'];
  final supabaseKey = dotenv.env['SUPABASE_ANON_KEY'];
  
  if (supabaseUrl != null && supabaseKey != null && supabaseUrl.isNotEmpty && supabaseKey.isNotEmpty) {
      await Supabase.initialize(url: supabaseUrl, anonKey: supabaseKey);
  } else {
    print("Supabase config missing or empty. App will run in limited mode.");
  }

  runApp(const ProviderScope(child: RedSquigglyApp()));
}

final _router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/auth',
      builder: (context, state) => const AuthScreen(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsScreen(),
    ),
    GoRoute(
      path: '/quiz',
      builder: (context, state) {
        final extra = state.extra as Map<String, dynamic>? ?? {};
        final count = extra['count'] as int? ?? 10;
        final levels = extra['levels'] as List<String>? ?? [];
        return QuizScreen(quizLength: count, levels: levels);
      },
    ),
  ],
);

class RedSquigglyApp extends StatelessWidget {
  const RedSquigglyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Red Squiggly',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFFF5252), // Red Accent
            brightness: Brightness.light,
        ),
        useMaterial3: true,
        textTheme: GoogleFonts.poppinsTextTheme(),
      ),
      routerConfig: _router,
    );
  }
}