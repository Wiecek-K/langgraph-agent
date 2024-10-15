import { ChatOpenAI } from "@langchain/openai";

process.env.OPENAI_API_KEY =
  "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";
process.env.TAVILY_API_KEY = "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";
process.env.GROQ_API_KEY =
  "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";

import { ChatGroq } from "@langchain/groq";

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
const evaluationModel = new ChatGroq({
  // model: "llama3-groq-8b-8192-tool-use-preview",
  model: "llama-3.1-70b-versatile",
  // model: "llama3-70b-8192",
  temperature: 0.1,
});

const executionModel = new ChatGroq({
  model: "llama3-groq-8b-8192-tool-use-preview",
  temperature: 0.1,
}).bindTools(tools);

// const model = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   temperature: 0,
// });

// Define the graph state
// See here for more info: https://langchain-ai.github.io/langgraphjs/how-tos/define-state/
const fetchProfile = (profileId: string) => ({
  name: "Jakub",
  bio: "Jestem doświadczonym programistą specializującym się w budowaniu aplikacji internetowych przy pomocy Reactjs",
});

const StateAnnotation = Annotation.Root({
  profileId: Annotation<string>(),
  profile: Annotation<{ name: string; bio: string }>(),
  evaluation: Annotation<string>(),
});

// Define the function that calls the model
async function retrieveProfile(state: typeof StateAnnotation.State) {
  const fetchedProfile = fetchProfile(state.profileId);

  return { profile: fetchedProfile };
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
  {name}
  {bio}
  
  `);

  // const evaluator = prompt.pipe(model.bindTools(tools));

  const evaluator = prompt.pipe(evaluationModel);

  const result = await evaluator.invoke({
    name: profile.name,
    bio: profile.bio,
  });

  return { ...state, evaluation: result.content };
}

async function executeDecision(state: typeof StateAnnotation.State) {
  const evaluation = state.evaluation;

  const prompt = PromptTemplate.fromTemplate(`
  Based on the following evaluation of a candidate's profile, execute the appropriate action using the provided tools.

  Evaluation:
  {evaluation}

  If the decision is to accept the profile, use the accept_profile tool.
  If the decision is to reject the profile, use the reject_profile tool and provide the reason for rejection.

  Use the appropriate tool.
  `);

  // const executor = prompt.pipe(executionModel.bindTools(tools));
  const executor = prompt.pipe(executionModel);

  const result = await executor.invoke({
    evaluation: evaluation,
  });

  // console.log("Execution result:", result);

  let toolResult;
  if (result.tool_calls) {
    if (result.tool_calls[0].name === "accept_profile") {
      toolResult = await acceptProfileTool.invoke({});
    } else if (result.tool_calls[0].name === "reject_profile") {
      toolResult = await rejectProfileTool.invoke({
        reason: result.tool_calls[0].args.reason,
      });
    } else {
      throw new Error(`Invalid tool specified: ${result.tool_calls[0].name}`);
    }
  } else {
    throw new Error(`Tool not specified`);
  }


  return { ...state };
}

// Define a new graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("retrieveProfile", retrieveProfile)
  .addNode("evaluateProfile", evaluateProfile)
  .addNode("executeDecision", executeDecision)
  .addEdge(START, "retrieveProfile")
  .addEdge("retrieveProfile", "evaluateProfile")
  .addEdge("evaluateProfile", "executeDecision")
  .addEdge("executeDecision", END);

// Finally, we compile it into a LangChain Runnable.
const app = workflow.compile();

// Use the agent

const evaluateProfileWorkflow = async (profileId: string) =>
  await app.invoke({
    profileId,
  });

const finalState = await evaluateProfileWorkflow("user_12378ajhs");

// console.log(finalState);

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
