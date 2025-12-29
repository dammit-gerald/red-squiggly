// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:red_squiggly/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    // Note: This might still show errors in logs if Supabase isn't mocked,
    // but it fixes the compilation error.
    await tester.pumpWidget(const ProviderScope(child: RedSquigglyApp()));

    // Verify that we see the app title
    expect(find.text('Red Squiggly'), findsOneWidget);
  });
}
