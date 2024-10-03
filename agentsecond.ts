// agent.ts

// IMPORTANT - Add your API keys here. Be careful not to publish them.
process.env.OPENAI_API_KEY =
  "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";
process.env.TAVILY_API_KEY = "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";
process.env.GROQ_API_KEY =
  "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";

import { ChatOpenAI } from "@langchain/openai";

import { ChatGroq } from "@langchain/groq";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
// Define the tools for the agent to use
const getCoolestCities = tool(
  () => {
    return "nyc, sf";
  },
  {
    name: "get_coolest_cities",
    description: "Get a list of coolest cities",
    schema: z.object({
      noOp: z.string().optional().describe("No-op parameter."),
    }),
  }
);

const proofreadingToolSchema = z.object({
  action: z
    .enum(["reject", "accept"])
    .describe("The type of operation to execute."),
  reason: z
    .string()
    .optional()
    .describe("The reason why did you rejected user text"),
  id: z.string().describe("The id of user profile"),
});
const proofreadingTool = tool(
  async ({ action, reason, id }) => {
    // Functions must return strings
    if (!id) throw new Error("ID missing");

    if (action === "accept") {
      console.log("ACCEPTED", id);
      return `ACCEPTED: ==>`;
    } else if (action === "reject") {
      console.log("REJECTED", id, reason);
      return `REJECTED bcs: ${reason}`;
    } else {
      throw new Error("Invalid operation.");
    }
  },
  {
    name: "proofreadingTool",
    description: "Call to handle accept or reject User Profile",
    schema: proofreadingToolSchema,
  }
);

const tools = [
  new TavilySearchResults({ maxResults: 3 }),
  getCoolestCities,
  proofreadingTool,
];
const toolNode = new ToolNode(tools);

// Create a model and give it access to the tools
const model = new ChatGroq({
  // model: "llama3-groq-8b-8192-tool-use-preview",
  model: "llama-3.1-70b-versatile",
  // model: "llama3-70b-8192",
  temperature: 0.1,
}).bindTools(tools);
// const model = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   temperature: 0,
// }).bindTools(tools);
// Define the graph state
// See here for more info: https://langchain-ai.github.io/langgraphjs/how-tos/define-state/
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof StateAnnotation.State) {
  const messages = state.messages;

  const lastMessage = messages[messages.length - 1] as AIMessage;
  console.log(lastMessage);

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    return "tools";
  }
  // Otherwise, we stop (reply to the user) using the special "__end__" node
  return "__end__";
}

// Define the function that calls the model
async function callModel(state: typeof StateAnnotation.State) {
  const messages = state.messages;
  const response = await model.invoke(messages);

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


// Use the agent
const finalState = await app.invoke({
  messages: [
    new HumanMessage(`You are an assistant to a recruiter in the IT industry.

      You will receive a profile containing the candidate’s Name, BIO, and ID.
      
      Before we send the applicant’s profile to our client, for whom we are seeking specialists, we need to ensure that the submitted applications meet our standards.
      
      Create a notebook for yourself in which you will mark whether the submitted profile meets the following conditions: 
      
      Conditions:
      '''
      The name contains obscene or offensive words, fictitious character’s name or non humman name
      The BIO contains obscene or offensive words, lenght is shorter than ten words, is in a language other than Polish or English, contains spelling errors, is written in an unprofessional style
      '''
      After verifying all the conditions, check the contents of the notebook. If at least one condition is marked as met, Reject the profile.
      
      UserProfile: 
      '''
      {"name": "Kowalski Tomasz", "bio": "10 words", "id": "user_12378ajhs"} 
      '''
      `),
  ],
});

// console.log(finalState.messages[finalState.messages.length - 1].content);

// const nextState = await app.invoke({
//   // Including the messages from the previous run gives the LLM context.
//   // This way it knows we're asking about the weather in NY
//   messages: [
//     ...finalState.messages,
//     new HumanMessage(`give me a list of coolest cities`),
//   ],
// });
// console.log(nextState.messages[nextState.messages.length - 1].content);

// new HumanMessage(`You are an assistant to a recruiter in the IT industry.

//   You will receive a profile containing the candidate’s Name, BIO, and ID.

//   Before we send the applicant’s profile to our client, for whom we are seeking specialists, we need to ensure that the submitted applications meet our standards.

//   Create a notebook for yourself in which you will mark whether the submitted profile meets the following conditions:

//   Conditions:
//   '''The name contains obscene or offensive words
//   A fictitious character’s name is provided
//   The BIO contains obscene or offensive words
//   The BIO is shorter than 10 words
//   The BIO is in a language other than Polish or English
//   The BIO contains spelling errors
//   The BIO is written in an unprofessional style
//   '''
//   After verifying all the conditions, check the contents of the notebook. If at least one condition is marked as met: Reject the profile.
//   UserProfile:
//   '''
//   {name: "Czerwony Kapturek", bio: "aloha", id:"user_12378ajhs"}
//   '''`),
