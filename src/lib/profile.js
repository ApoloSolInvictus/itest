const PROFILE_TYPES = new Set(["student", "educator", "employer"]);

export async function requestProfile(user, profileType = "", displayName = "") {
  const token = await user.getIdToken();
  const response = await fetch("/api/profile", {
    method: profileType ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(profileType ? { "Content-Type": "application/json" } : {})
    },
    ...(profileType ? { body: JSON.stringify({ profileType, displayName }) } : {}),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The iTest profile could not be loaded.");
  const type = data.profile?.type || "";
  if (type && !PROFILE_TYPES.has(type)) throw new Error("The saved iTest profile is not valid.");
  return { type, needsProfileType: data.needsProfileType === true, roleLocked: data.roleLocked === true };
}
