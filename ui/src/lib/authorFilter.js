// Author scope for the inbox, a sibling of repoFilter.js. Fork-owned: upstream never touches it.
export function availableAuthors(...lists) {
  return [...new Set(lists.flat().map((pr) => pr.author).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export const filterByAuthors = (prs, authors) => authors.length ? prs.filter((pr) => authors.includes(pr.author)) : prs;
