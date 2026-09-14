// Staged review comments. The route shape mirrors the review tab's so the dev proxy needs no new rule.
export async function fetchPendingReview(repo, number) {
  const res = await fetch(`/api/pending-review/${repo}/${number}`);
  if (!res.ok) throw new Error(`pending review ${res.status}`);
  return res.json();
}

export async function setPendingReviewMode(repo, number, staged) {
  const res = await fetch(`/api/pending-review/${repo}/${number}/mode`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staged }),
  });
  if (!res.ok) throw new Error(`pending review mode ${res.status}`);
  return res.json();
}

export async function editPendingComment(repo, number, id, body) {
  const res = await fetch(`/api/pending-review/${repo}/${number}/comment/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`edit staged comment ${res.status}`);
  return res.json();
}

export async function deletePendingComment(repo, number, id) {
  const res = await fetch(`/api/pending-review/${repo}/${number}/comment/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete staged comment ${res.status}`);
  return res.json();
}
