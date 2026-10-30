import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
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
  const router = useRouter();
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState("");

  async function submit() {
    if (pending) return;
    const nextEmail = email.trim();
    if (!nextEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending("email");
    setError("");
    try {
      const result = await authClient.signIn.email({ email: nextEmail, password });
      if (result.error) setError(signInErrorMessage({ status: result.error.status }));
    } catch {
      setError(signInErrorMessage({ offline: true }));
    } finally {
      setPending(null);
    }
  }

  async function signInWithGoogle() {
    if (pending) return;
    setPending("google");
    setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
      if (result.error) {
        setError(result.error.status === 429 ? "Too many attempts. Try again shortly." : "Google sign-in is not available. Try email instead.");
        return;
      }
      router.replace("/");
    } catch {
      setError(signInErrorMessage({ offline: true }));
    } finally {
      setPending(null);
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
    <SafeAreaView style={styles.screen} testID="sign-in-screen">
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
          <Pressable
            accessibilityLabel={pending === "google" ? "Opening Google" : "Continue with Google"}
            accessibilityRole="button"
            testID="google-sign-in"
            accessibilityState={{ busy: pending === "google", disabled: pending !== null }}
            disabled={pending !== null}
            onPress={() => {
              void signInWithGoogle();
            }}
            style={[styles.googleButton, pending ? styles.buttonBusy : null]}
          >
            <Text style={styles.googleButtonText}>{pending === "google" ? "Opening Google…" : "Continue with Google"}</Text>
          </Pressable>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or use email</Text>
            <View style={styles.dividerLine} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
              testID="sign-in-email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!pending}
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
              testID="sign-in-password"
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              editable={!pending}
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
            disabled={pending !== null}
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
            accessibilityLabel={pending === "email" ? "Signing in" : "Sign in"}
            accessibilityRole="button"
            testID="sign-in-submit"
            accessibilityState={{ busy: pending === "email", disabled: pending !== null }}
            disabled={pending !== null}
            onPress={() => {
              void submit();
            }}
            style={[styles.button, pending ? styles.buttonBusy : null]}
          >
            <Text style={styles.buttonText}>{pending === "email" ? "Signing in…" : "Sign in"}</Text>
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
  googleButton: {
    minHeight: theme.touchTarget,
    borderRadius: theme.radiusLarge,
    borderWidth: 1,
    borderColor: theme.muted,
    backgroundColor: theme.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  googleButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.muted,
    opacity: 0.45,
  },
  dividerText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: "600",
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
