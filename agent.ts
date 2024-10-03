import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { Tool } from "@langchain/core/tools";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
// IMPORTANT - Add your API keys here. Be careful not to publish them.
process.env.OPENAI_API_KEY =
  "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";
process.env.TAVILY_API_KEY = "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";
process.env.GROQ_API_KEY =
  "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";
import { ChatGroq } from "@langchain/groq";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";

// Definicja interfejsu dla profilu użytkownika
interface UserProfile {
  name: string;
  description: string;
}

// Definicja stanu grafu
interface WorkflowState {
  profile: UserProfile;
  reason: string | null;
  meetsRequirements: string | null;
}

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

// Definiowanie schematu wyjściowego za pomocą Zod
const offensiveWordsSchema = z.object({
  containsOffensiveWords: z.boolean(),
  explanation: z.string(),
});

// Funkcja do sprawdzania obraźliwych słów z użyciem StructuredOutput i Zod
const checkOffensiveWords = async (state: WorkflowState) => {
  const llm = new ChatOpenAI({ temperature: 0 });
  const parser = StructuredOutputParser.fromZodSchema(offensiveWordsSchema);

  const prompt = PromptTemplate.fromTemplate(
    "Sprawdź, czy w poniższym opisie profilu występują obraźliwe słowa: {profile}\n" +
      "Odpowiedz w formacie JSON zgodnie z następującą specyfikacją:\n" +
      "{format_instructions}\n"
  );

  const chain = RunnableSequence.from([prompt, llm, parser]);

  const result = await chain.invoke({
    description: state.profile.description,
    format_instructions: parser.getFormatInstructions(),
  });

  return {
    ...state,
    meetsRequirements: !result.containsOffensiveWords,
    reason: result.explanation,
  };
};

// Funkcja do wyboru akcji
const chooseAction = async (state: WorkflowState) => {
  const llm = new ChatGroq({
    // model: "llama3-groq-8b-8192-tool-use-preview",
    model: "llama-3.1-70b-versatile",
    // model: "llama3-70b-8192",
    temperature: 0.1,
  });
  const prompt = PromptTemplate.fromTemplate(
    "Na podstawie wyniku sprawdzenia profilu, wybierz odpowiednie działanie:\n" +
      "Spełnia wymagania? : {meetsRequirements}\n" +
      "Wyjaśnienie: {reason}\n" +
      "Jeśli wynik to 'false', użyj RejectProfile. Jeśli 'true', użyj SaveProfile.\n" +
      "Odpowiedz tylko nazwą wybranego działania."
  );

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    containsOffensiveWords: String(state.offensiveContent),
    offensiveContentExplanation: String(state.offensiveContentExplanation),
  });
  return {
    ...state,
    action: result.content,
  };
};

// Create a model and give it access to the tools
const llmWithTools = new ChatGroq({
  model: "llama3-groq-8b-8192-tool-use-preview",
  // model: "llama-3.1-70b-versatile",
  // model: "llama3-70b-8192",
  temperature: 0.1,
}).bindTools(tools);

// Funkcja do wykonania akcji
const executeAction = async (state: WorkflowState) => {
  const tools = {
    SaveProfile: new SaveProfileTool(),
    RejectProfile: new RejectProfileTool(),
  };
  const selectedTool = tools[state.action as keyof typeof tools];
  if (selectedTool) {
    const result = await selectedTool.call(JSON.stringify(state.profile));
    console.log(result);
  } else {
    console.log("Nieznana akcja:", state.action);
  }
  return state;
};

const State = Annotation.Root({
  profile: Annotation<UserProfile>,
  meetsRequirements: Annotation<boolean>,
  reason: Annotation<string>,
});
// Tworzenie grafu workflow
const workflowGraph = new StateGraph(State);

async function callModel(state: typeof State.State) {
  const profile = state.profile;
  const meetsRequirements = state.meetsRequirements;
  const reason = state.reason;

  const response = await model.invoke(messages);

  // We return a list, because this will get added to the existing list
  return { messages: [response] };
}

// Dodawanie węzłów do grafu
workflowGraph.addNode("check_offensive", checkOffensiveWords);
workflowGraph.addNode("tools", toolNode);
workflowGraph.addNode("choose_action", chooseAction);
workflowGraph.addNode("execute_action", executeAction);

// Definiowanie przepływu w grafie
workflowGraph.addEdge("check_offensive", "choose_action");
workflowGraph.addEdge("choose_action", "execute_action");
workflowGraph.addEdge("execute_action", END);

// Kompilacja grafu
const workflow = workflowGraph.compile();

// Funkcja do uruchamiania workflow
async function runWorkflow(profile: UserProfile) {
  const initialState: WorkflowState = {
    profile,
    offensiveContent: null,
    offensiveContentExplanation: null,
    action: null,
  };
  const result = await workflow.invoke(initialState);
  return result;
}

// Przykładowe użycie
const profile: UserProfile = {
  name: "Jan Kowalski",
  description: "Jestem przyjazną osobą lubiącą spotkania z ludźmi.",
};

runWorkflow(profile).then(console.log).catch(console.error);

// // IMPORTANT - Add your API keys here. Be careful not to publish them.
// process.env.OPENAI_API_KEY =
//   "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";
// process.env.TAVILY_API_KEY = "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";
// process.env.GROQ_API_KEY =
//   "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";

// import { ChatOpenAI } from "@langchain/openai";

// import { ChatGroq } from "@langchain/groq";
// import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

// import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
// import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { StateGraph, Annotation } from "@langchain/langgraph";
// import { tool } from "@langchain/core/tools";
// import { z } from "zod";
// // Define the tools for the agent to use
// const getCoolestCities = tool(
//   () => {
//     return "nyc, sf";
//   },
//   {
//     name: "get_coolest_cities",
//     description: "Get a list of coolest cities",
//     schema: z.object({
//       noOp: z.string().optional().describe("No-op parameter."),
//     }),
//   }
// );

// const acceptProfileTool = tool(
//   async () => {
//     console.log("accepted");
//     return `Profil został zaakceptowany i zapisany: `;
//   },

//   {
//     name: "accept_profile",
//     description: "Accept user apply and save his profile in our database",
//     schema: z.object({}),
//   }
// );

// const rejectProfileToolSchema = z.object({
//   reason: z.string().describe("The reason why did you rejected user profile"),
// });
// const rejectProfileTool = tool(
//   async ({ reason }) => {
//     console.log("rejected", reason);
//     return `Profil został odrzucony. Powód: ${reason}`;
//   },
//   {
//     name: "reject_profile",
//     description: "Reject user apply and informing him about reason",
//     schema: rejectProfileToolSchema,
//   }
// );

// const tools = [
//   new TavilySearchResults({ maxResults: 3 }),
//   getCoolestCities,
//   acceptProfileTool,
//   rejectProfileTool,
// ];
// const toolNode = new ToolNode(tools);

// // Create a model and give it access to the tools
// const model = new ChatGroq({
//   // model: "llama3-groq-8b-8192-tool-use-preview",
//   model: "llama-3.1-70b-versatile",
//   // model: "llama3-70b-8192",
//   temperature: 0.1,
// }).bindTools(tools);

// // const model = new ChatOpenAI({
// //   model: "gpt-4o-mini",
// //   temperature: 0,
// // }).bindTools(tools);

// // Define the graph state
// // See here for more info: https://langchain-ai.github.io/langgraphjs/how-tos/define-state/
// const StateAnnotation = Annotation.Root({
//   messages: Annotation<BaseMessage[]>({
//     reducer: (x, y) => x.concat(y),
//   }),
// });

// // Define the function that determines whether to continue or not
// function shouldContinue(state: typeof StateAnnotation.State) {
//   const messages = state.messages;

//   const lastMessage = messages[messages.length - 1] as AIMessage;
//   console.log(lastMessage);

//   // If the LLM makes a tool call, then we route to the "tools" node
//   if (lastMessage.tool_calls?.length) {
//     return "tools";
//   }
//   // Otherwise, we stop (reply to the user) using the special "__end__" node
//   return "__end__";
// }

// // Define the function that calls the model
// async function callModel(state: typeof StateAnnotation.State) {
//   const messages = state.messages;
//   const response = await model.invoke(messages);

//   // We return a list, because this will get added to the existing list
//   return { messages: [response] };
// }

// // Define a new graph
// const workflow = new StateGraph(StateAnnotation)
//   .addNode("agent", callModel)
//   .addNode("tools", toolNode)
//   .addEdge("__start__", "agent")
//   .addConditionalEdges("agent", shouldContinue)
//   .addEdge("tools", "agent");

// // Finally, we compile it into a LangChain Runnable.
// const app = workflow.compile();

// // Use the agent
// const finalState = await app.invoke({
//   messages: [
//     new HumanMessage(`You are an assistant to a recruiter in the IT industry.

//       You will receive a profile containing the candidate’s Name, BIO, and ID.

//       Before we send the applicant’s profile to our client, for whom we are seeking specialists, we need to ensure that the submitted applications meet our standards.

//       Create a notebook for yourself in which you will mark whether the submitted profile meets the following conditions:

//       Conditions:
//       '''
//       The name contains obscene or offensive words, fictitious character’s name or non humman name
//       The BIO contains obscene or offensive words, lenght is shorter than ten words, is in a language other than Polish or English, contains spelling errors, is written in an unprofessional style
//       '''
//       After verifying all the conditions, check the contents of the notebook. If at least one condition is marked as met, Reject the profile.

//       UserProfile:
//       '''
//       {"name": "Kowalski Tomasz", "bio": "10 words", "id": "user_12378ajhs"}
//       '''
//       `),
//   ],
// });

// // console.log(finalState.messages[finalState.messages.length - 1].content);

// // const nextState = await app.invoke({
// //   // Including the messages from the previous run gives the LLM context.
// //   // This way it knows we're asking about the weather in NY
// //   messages: [
// //     ...finalState.messages,
// //     new HumanMessage(`give me a list of coolest cities`),
// //   ],
// // });
// // console.log(nextState.messages[nextState.messages.length - 1].content);
