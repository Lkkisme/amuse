/**
 * Settings data still local to the web app (the secure store), until it is
 * the server's.
 */

export interface Credential {
  id: string;
  domain: string;
  username: string;
}

export interface SettingsData {
  credentials: Credential[];
}

export function seedSettings(): SettingsData {
  return {
    credentials: [{ id: "cred1", domain: "ucsd.edu", username: "student portal" }],
  };
}
