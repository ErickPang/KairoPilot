fetch('https://html.duckduckgo.com/html/?q=openai', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
}).then(r => r.text()).then(html => {
  const snippets = html.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi);
  console.log(snippets ? snippets.slice(0, 3) : "no match");
})
