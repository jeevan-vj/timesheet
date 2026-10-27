import * as Linking from "expo-linking";
import { useRef, useState, type ComponentRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signInErrorMessage } from "@/api-config";
import { authClient } from "@/auth-client";
import { apiBaseUrl } from "@/runtime-config";
import { theme } from "@/theme";

export function SignInForm() {
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    const nextEmail = email.trim();
    if (!nextEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: nextEmail, password });
      if (result.error) setError(signInErrorMessage({ status: result.error.status }));
    } catch {
      setError(signInErrorMessage({ offline: true }));
    } finally {
      setBusy(false);
    }
  }

  async function openWeb(path: "/sign-in" | "/sign-up") {
    try {
      await Linking.openURL(`${apiBaseUrl()}${path}`);
    } catch {
      setError("Could not open the CleanTrack website.");
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>CleanTrack</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Sign in
          </Text>
          <Text style={styles.detail}>See your next job, this week’s hours, and your pay.</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!busy}
              importantForAutofill="yes"
              inputMode="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="name@example.com"
              placeholderTextColor={theme.muted}
              returnKeyType="next"
              spellCheck={false}
              style={styles.input}
              textContentType="username"
              value={email}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              ref={passwordRef}
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              editable={!busy}
              importantForAutofill="yes"
              onChangeText={setPassword}
              onSubmitEditing={() => {
                void submit();
              }}
              placeholder="Password"
              placeholderTextColor={theme.muted}
              returnKeyType="go"
              secureTextEntry={!showPassword}
              spellCheck={false}
              style={styles.input}
              textContentType="password"
              value={password}
            />
          </View>
          <Pressable
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setShowPassword((current) => !current)}
            style={styles.link}
          >
            <Text style={styles.linkText}>{showPassword ? "Hide password" : "Show password"}</Text>
          </Pressable>
          {error ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel={busy ? "Signing in" : "Sign in"}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => {
              void submit();
            }}
            style={[styles.button, busy ? styles.buttonBusy : null]}
          >
            <Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
          <Text style={styles.note}>Creating an account and resetting a password stay on the website.</Text>
          <Pressable
            accessibilityHint="Opens the CleanTrack website"
            accessibilityLabel="Create an account on the web"
            accessibilityRole="link"
            onPress={() => {
              void openWeb("/sign-up");
            }}
            style={styles.link}
          >
            <Text style={styles.linkText}>Create an account on the web</Text>
          </Pressable>
          <Pressable
            accessibilityHint="Opens the CleanTrack website"
            accessibilityLabel="Reset password on the web"
            accessibilityRole="link"
            onPress={() => {
              void openWeb("/sign-in");
            }}
            style={styles.link}
          >
            <Text style={styles.linkText}>Reset password on the web</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
  },
  brand: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  title: {
    color: theme.text,
    fontSize: 32,
    fontWeight: "700",
  },
  detail: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  field: {
    gap: 8,
  },
  label: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "600",
  },
  input: {
    minHeight: theme.touchTarget,
    borderRadius: theme.radius,
    backgroundColor: theme.surfaceRaised,
    color: theme.text,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  error: {
    color: theme.text,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    minHeight: theme.touchTarget,
    borderRadius: theme.radiusLarge,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: theme.accentText,
    fontSize: 16,
    fontWeight: "700",
  },
  note: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
  },
  linkText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
