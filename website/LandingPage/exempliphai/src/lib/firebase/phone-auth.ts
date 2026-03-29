import {
  PhoneAuthProvider,
  signInWithCredential,
  type Auth,
  type UserCredential,
} from "firebase/auth";

export async function signInWithVerificationIdAndCode(
  auth: Auth,
  verificationId: string,
  code: string,
): Promise<UserCredential> {
  const credential = PhoneAuthProvider.credential(verificationId, code);
  return signInWithCredential(auth, credential);
}
