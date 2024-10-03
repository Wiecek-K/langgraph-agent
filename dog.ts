import { PromptTemplate } from "@langchain/core/prompts";
import { LLMChain } from "@langchain/core/prompts";
import { BufferMemory } from "langchain/memory";
import { ChatGroq } from "@langchain/groq";

// Inicjalizacja pierwszego modelu, który sprawdza, czy tekst dotyczy psa
const dogCheckModel = new OpenAI();

// Prompt do sprawdzenia, czy tekst dotyczy psa
const dogCheckPrompt = new PromptTemplate({
  inputVariables: ["text"],
  template:
    "Czy tekst '{text}' odnosi się do psa? Odpowiedz tylko 'tak' lub 'nie'.",
});

// Łańcuch, który używa pierwszego modelu do sprawdzenia, czy tekst dotyczy psa
const dogCheckChain = new LLMChain({
  llm: dogCheckModel,
  prompt: dogCheckPrompt,
  memory: new BufferMemory(),
});

// Inicjalizacja drugiego modelu, który będzie używał stanu agenta
const responseGenerationModel = new OpenAI();

// Prompt, który wykorzystuje stan agenta do wygenerowania odpowiedzi
const responseGenerationPrompt = new PromptTemplate({
  inputVariables: ["isDogText", "text"],
  template: `
    {#if isDogText}
      Wspaniale, tekst '{text}' odnosi się do psa. Oto moja rozszerzona odpowiedź na temat psa:
    {#else}
      Niestety, tekst '{text}' nie odnosi się do psa. Oto moja standardowa odpowiedź:
    {/if}
  `,
});

// Łańcuch, który używa drugiego modelu do wygenerowania odpowiedzi w oparciu o stan agenta
const responseGenerationChain = new LLMChain({
  llm: responseGenerationModel,
  prompt: responseGenerationPrompt,
  memory: new BufferMemory(),
});

// Funkcja, która uruchamia pełny workflow
async function handleText(text: string) {
  // Użyj pierwszego modelu do sprawdzenia, czy tekst dotyczy psa
  const isDogText = (await dogCheckChain.call({ text })) === "tak";

  // Zapisz stan agenta (czy tekst dotyczy psa)
  await responseGenerationChain.memory.loadMemoryVariables({ isDogText });

  // Użyj drugiego modelu do wygenerowania odpowiedzi
  const response = await responseGenerationChain.call({ text });
  console.log(response);
}

// Przykładowe użycie
handleText("Mój pies jest bardzo słodki.");
// Wyjście: "Wspaniale, tekst 'Mój pies jest bardzo słodki.' odnosi się do psa. Oto moja rozszerzona odpowiedź na temat psa:"

handleText("Lubię chodzić na spacery.");
// Wyjście: "Niestety, tekst 'Lubię chodzić na spacery.' nie odnosi się do psa. Oto moja standardowa odpowiedź:"
