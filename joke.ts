process.env.GROQ_API_KEY =
  "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";

import { ChatGroq } from "@langchain/groq";

const model = new ChatGroq({
  model: "mixtral-8x7b-32768",
  temperature: 0,
});

import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromTemplate("tell me a joke about {topic}");

const chain = prompt.pipe(model).pipe(new StringOutputParser());

import { RunnableLambda } from "@langchain/core/runnables";

const analysisPrompt = ChatPromptTemplate.fromTemplate(
  "is this a funny joke? {joke}"
);
import { RunnableSequence } from "@langchain/core/runnables";

const composedChainWithLambda = RunnableSequence.from([
  chain,
  (input) => ({ joke: input }),
  analysisPrompt,
  model,
  new StringOutputParser(),
]);

const response = await composedChainWithLambda.invoke({ topic: "bears" });

console.log(response);
