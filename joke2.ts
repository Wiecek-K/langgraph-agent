process.env.GROQ_API_KEY =
  "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";

import { ChatGroq } from "@langchain/groq";

const model = new ChatGroq({
  model: "mixtral-8x7b-32768",
  temperature: 0,
});

import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const prompt =
  ChatPromptTemplate.fromTemplate(`Check if the submitted profile meets the requirements below.
    Just answer in one sentence if profile meets requirements and why.
     Requirements:
     The name dosen't contains obscene or offensive words, fictitious character’s name or non humman name
      The BIO dosen't contains obscene or offensive words, lenght is shorter than ten words, is in a language other than Polish or English, contains spelling errors, is written in an unprofessional style
    Name: {name}
    BIO: {bio}
      `);

const chain = prompt.pipe(model).pipe(new StringOutputParser());

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const acceptProfileTool = tool(
  async () => {
    console.log("accepted");
    return `Profil został zaakceptowany i zapisany: `;
  },

  {
    name: "accept_profile",
    description: "Accept user apply and save his profile in our database",
    schema: z.object({}),
  }
);

const rejectProfileToolSchema = z.object({
  reason: z.string().describe("The reason why did you rejected user profile"),
});
const rejectProfileTool = tool(
  async ({ reason }) => {
    console.log("rejected", reason);
    return `Profil został odrzucony. Powód: ${reason}`;
  },
  {
    name: "reject_profile",
    description: "Reject user apply and informing him about reason",
    schema: rejectProfileToolSchema,
  }
);
const tools = [rejectProfileTool, acceptProfileTool];
const toolNode = new ToolNode(tools);

const llmWithTools = new ChatGroq({
  model: "llama3-groq-8b-8192-tool-use-preview",
  // model: "llama-3.1-70b-versatile",
  // model: "llama3-70b-8192",
  temperature: 0,
}).bindTools(tools);

const analysisPrompt = ChatPromptTemplate.fromTemplate(
  "Invoke the appropriate tool: User profille meets requirements: {reportResult}"
);
import { RunnableLambda } from "@langchain/core/runnables";

const composedChain = new RunnableLambda({
  func: async (input: { name: string; bio: string }) => {
    const result = await chain.invoke(input);
    console.log(result);

    return { reportResult: result };
  },
})
  .pipe(analysisPrompt)
  .pipe(llmWithTools)
  .pipe(new StringOutputParser());

// const response = await composedChain.invoke({
//   name: "Jan Kowalski",
//   bio: "I am a programmer with over eight years of experience. My specialty is creating websites using React.js.",
// });

import { StateGraph, Annotation } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  name: Annotation<string>(),
  bio: Annotation<string>(),
  reason: Annotation<string>(),
  result: Annotation<string>(),
});

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof StateAnnotation.State) {
  const messages = state.messages;

  const lastMessage = messages[messages.length - 1] as AIMessage;
  console.log(lastMessage);

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    console.log("tools");

    return "tools";
  }
  // Otherwise, we stop (reply to the user) using the special "__end__" node
  console.log("end");
  
  return "__end__";
}

// Define the function that calls the model
async function callModel(state: typeof StateAnnotation.State) {
  const messages = state.messages;
  const result = state.result;
  const bio = state.bio;
  const name = state.name;
  const reason = state.reason;

  const response = await composedChain.invoke({ name, bio });

  // We return a list, because this will get added to the existing list
  return { messages: [response] };
}

// Define a new graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

// Finally, we compile it into a LangChain Runnable.
const app = workflow.compile();

const finalState = await app.invoke(
  {
    name: "Jan Kowalski",
    bio: "I am a programmer with over eight years of experience. My specialty is creating websites using React.js.",
  },
  { configurable: { thread_id: "42" } }
);

console.log(finalState);

// const resp = await llmWithTools.invoke("odrzuć profil");
// console.log(resp.tool_calls);

// console.log("test", response);
