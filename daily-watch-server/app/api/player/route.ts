import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
import { RETURN_TO, utcDay } from "../_lib/claim-policy.mjs";
import { apiError, json, profileFor } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getChatGPTUser();
    const now = new Date();
    return json({
      signedIn: !!user,
      day: utcDay(now),
      serverTime: now.toISOString(),
      signinUrl: chatGPTSignInPath(RETURN_TO),
      signoutUrl: chatGPTSignOutPath(RETURN_TO),
      profile: user ? await profileFor(user.userId) : null,
    });
  } catch (error) { return apiError(error); }
}
