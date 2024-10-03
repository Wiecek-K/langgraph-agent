// agent.ts

// IMPORTANT - Add your API keys here. Be careful not to publish them.
// const openApiKey = process.env.OPENAI_API_KEY;
// const tavilyApiKey = process.env.TAVILY_API_KEY;
process.env.OPENAI_API_KEY =
  "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";
process.env.TAVILY_API_KEY = "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";
// console.log(openApiKey, tavilyApiKey);

import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, MemorySaver, Annotation } from "@langchain/langgraph";

// Define the tools for the agent to use
const tools = [new TavilySearchResults({ maxResults: 3 })];
const toolNode = new ToolNode(tools);

// Create a model and give it access to the tools
const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
}).bindTools(tools);

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
  console.log(messages);

  const lastMessage = messages[messages.length - 1] as AIMessage;

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
  .addEdge("__start__", "agent") // __start__ is a special name for the entrypoint
  .addNode("tools", toolNode)
  .addEdge("tools", "agent")
  .addConditionalEdges("agent", shouldContinue);

// Finally, we compile it into a LangChain Runnable.
const app = workflow.compile();

// Use the agent
const finalState = await app.invoke(
  {
    messages: [new HumanMessage("what is the weather in sf")],
  },
  { configurable: { thread_id: "42" } }
);

console.log(finalState.messages[finalState.messages.length - 1].content);

const nextState = await app.invoke({
  // Including the messages from the previous run gives the LLM context.
  // This way it knows we're asking about the weather in NY
  messages: [...finalState.messages, new HumanMessage("what about ny")],
});
console.log(nextState.messages[nextState.messages.length - 1].content);
// const AIMessage = {
//   content: "",
//   additional_kwargs: {
//     tool_calls: [
//       {
//         id: "call_j4wx",
//         type: "function",
//         function: "[Object]",
//       },
//     ],
//   },
//   response_metadata: {
//     tokenUsage: {
//       completionTokens: 31,
//       promptTokens: 709,
//       totalTokens: 740,
//     },
//     finish_reason: "tool_calls",
//   },
//   tool_calls: [
//     {
//       name: "proofreadingTool",
//       args: {
//         action: "accept",
//         id: "user_12378ajhs",
//         reason: "",
//       },
//       type: "tool_call",
//       id: "call_j4wx",
//     },
//   ],
//   invalid_tool_calls: [],
//   usage_metadata: {
//     input_tokens: 709,
//     output_tokens: 31,
//     total_tokens: 740,
//   },
// };
// console.log(AIMessage.tool_calls);
