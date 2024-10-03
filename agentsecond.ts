// agent.ts

// IMPORTANT - Add your API keys here. Be careful not to publish them.
import { ChatOpenAI } from "@langchain/openai";

process.env.OPENAI_API_KEY =
  "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";
process.env.TAVILY_API_KEY = "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";
process.env.GROQ_API_KEY =
  "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";

import { ChatGroq } from "@langchain/groq";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PromptTemplate } from "@langchain/core/prompts";


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

const tools = [acceptProfileTool, rejectProfileTool];

// Create a model and give it access to the tools
const model = new ChatGroq({
  // model: "llama3-groq-8b-8192-tool-use-preview",
  model: "llama-3.1-70b-versatile",
  // model: "llama3-70b-8192",
  temperature: 0.1,
})

// const model = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   temperature: 0,
// });

// Define the graph state
// See here for more info: https://langchain-ai.github.io/langgraphjs/how-tos/define-state/
const fetchProfile = (profileId: string) => ({
  name: "Jakub",
  bio: "I am a cool dupa dupa dupa dupa dupa dupa"
})

const StateAnnotation = Annotation.Root({
  profileId: Annotation<string>(),
  profile: Annotation<{ name: string, bio: string }>(),
});

// Define the function that calls the model
async function retrieveProfile(state: typeof StateAnnotation.State) {

  const fetchedProfile = fetchProfile(state.profileId);

  return { profile: fetchedProfile};
}

async function evaluateProfile(state: typeof StateAnnotation.State) {

  const profile = state.profile;

  const prompt = PromptTemplate.fromTemplate(`
  
  You are an assistant to a recruiter in the IT industry. 
  You will receive a profile containing the candidate’s Name, BIO, and ID.
  Before we send the applicant’s profile to our client, for whom we are seeking specialists, we need to ensure that the submitted applications meet our standards.
  Approve or reject the profile based on the following conditions:
  Conditions:
  '''The name contains obscene or offensive words
  A fictitious character’s name is provided
  The BIO contains obscene or offensive words
  The BIO is shorter than 10 words
  The BIO is in a language other than Polish or English
  The BIO contains spelling errors
  The BIO is written in an unprofessional style
  '''
  
  Profile details:
  {profile}
  
  `)

  const evaluator = prompt.pipe(model.bindTools(tools))

  const decision = await evaluator.invoke({
    profile
  })

  console.log('decision', decision)

  return { ...state };
}

// Define a new graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("retrieveProfile", retrieveProfile)
  .addNode("evaluateProfile", evaluateProfile)
  .addEdge(START, "retrieveProfile")
  .addEdge("retrieveProfile", "evaluateProfile")
  .addEdge("evaluateProfile", END)

// Finally, we compile it into a LangChain Runnable.
const app = workflow.compile();


// Use the agent

const evaluateProfileWorkflow = async (profileId: string) => await app.invoke({
  profileId
});

const finalState = await evaluateProfileWorkflow("user_12378ajhs");

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
