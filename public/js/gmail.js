export function extractEmail(value) {
  return String(value || "").match(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/)?.[0] || "";
}

export function splitDraft(draftText) {
  const [subjectLine, ...rest] = String(draftText || "").split("\n\n");
  return {
    subject: (subjectLine || "").replace(/^Subject:\s*/i, "").trim(),
    body: rest.join("\n\n").trim(),
  };
}

export function gmailComposeUrl(email, draftText) {
  const { subject, body } = splitDraft(draftText);
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: email,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
