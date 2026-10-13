// The browser uses the local server because NYT's Wordle endpoint has no
// cross-origin permission for this site.
export async function loadWordleWord(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid game date.');
  const response = await fetch(`/api/wordle/${date}`);
  if (!response.ok) throw new Error("Today's Wordle answer is unavailable. Try again later.");
  const data = await response.json();
  if (data.date !== date || !/^[a-z]{5}$/.test(data.word)) {
    throw new Error("Today's Wordle answer is invalid. Try again later.");
  }
  return data.word;
}
