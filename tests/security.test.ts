import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { attachUser, type AuthedRequest } from "../src/auth/session.ts";
import type { Repo, UserRow } from "../src/db/repo.ts";

test("attachUser accepts an active session as a bearer token", () => {
  const user: UserRow = {
    id: "user-a", google_sub: null, email: "a@example.com", name: "A", created_at: new Date().toISOString(),
  };
  const repo = {
    getSession: (token: string) => token === "active-token"
      ? { token, user_id: user.id, expires_at: new Date(Date.now() + 60_000).toISOString(), created_at: new Date().toISOString() }
      : undefined,
    getUser: () => user,
    deleteSession: () => undefined,
  } as unknown as Repo;
  const req = { headers: { authorization: "Bearer active-token" } } as AuthedRequest;

  attachUser(repo)(req, {} as Response, () => undefined);

  assert.equal(req.user?.id, user.id);
});
