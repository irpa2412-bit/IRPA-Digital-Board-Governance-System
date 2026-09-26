      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential) throw new Error("Google authentication did not return a usable credential.");
      const primaryResult = await signInWithCredential(auth, credential);

      await signOut(adminOAuthAuth);
      window.sessionStorage.removeItem("irpaExpectedGoogleAdminEmail");
      window.sessionStorage.removeItem("irpaAdminRedirectPending");
      window.localStorage.removeItem("irpaExpectedGoogleAdminEmail");
      window.localStorage.removeItem("irpaAdminRedirectPending");
      await refreshMfaSecurityClaimBestEffort(primaryResult.user);
      return primaryResult.user;
    } catch (error) {
      try { await signOut(adminOAuthAuth); } catch (_) {}
      throw error;
    }
  }

  if (options.redirect === true) {
    window.sessionStorage.setItem("irpaExpectedGoogleAdminEmail", expected);
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  const result = await signInWithPopup(auth, googleProvider);
  const actual = String(result.user?.email || "").trim().toLowerCase();
  if (expected && actual !== expected) {
    await signOut(auth);
    throw new Error(`Use the designated IRPA administrator Google account: ${expected}.`);
  }
  await refreshMfaSecurityClaimBestEffort(result.user);
  return result.user;
}

export async function completeGoogleRedirect(expectedEmail = "") {
  const result = await getRedirectResult(auth);
  if (!result?.user) return null;
  const expected = String(expectedEmail || window.localStorage.getItem("irpaExpectedGoogleAdminEmail") || "").trim().toLowerCase();
  const actual = String(result.user?.email || "").trim().toLowerCase();
  if (expected && actual !== expected) {
    await signOut(auth);
    throw new Error(`Use the designated IRPA administrator Google account: ${expected}.`);
  }