import { auth } from "./firebase.js";

export async function callAi(payload) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in with Firebase to use AI features.");
  const token = await user.getIdToken();
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}
