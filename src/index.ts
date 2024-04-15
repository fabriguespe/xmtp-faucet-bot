import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import HandlerContext from "./handler-context";
import run from "./runner.js";
import { getRedisClient } from "./lib/redis.js";
import { LearnWeb3Client, Network } from "./lib/learn-web3.js";
import { CLAIM_EVERY, FIVE_MINUTES, FRAME_BASE_URL } from "./lib/constants.js";

const inMemoryCache = new Map<string, number>();

run(async (context: HandlerContext) => {
  const { message } = context;
  const wallet = privateKeyToAccount(process.env.KEY as `0x${string}`);

  const { content, senderAddress } = message;

  if (senderAddress?.toLowerCase() === wallet.address?.toLowerCase()) {
    // safely ignore this message
    return;
  }

  if (content === "reset") {
    inMemoryCache.set(senderAddress, 0);
  }

  const redisClient = await getRedisClient();

  const cachedSupportedNetworksData = await redisClient.get(
    "supported-networks"
  );
  let supportedNetworks: Network[];
  const learnWeb3Client = new LearnWeb3Client();
  if (
    !cachedSupportedNetworksData ||
    parseInt(JSON.parse(cachedSupportedNetworksData!)?.lastSyncedAt) >
      Date.now() + FIVE_MINUTES
  ) {
    const updatedSupportedNetworksData = await learnWeb3Client.getNetworks();
    await redisClient.set(
      "supported-networks",
      JSON.stringify({
        lastSyncedAt: Date.now(),
        supportedNetworks: updatedSupportedNetworksData,
      })
    );
    supportedNetworks = updatedSupportedNetworksData;
  } else {
    supportedNetworks = JSON.parse(
      cachedSupportedNetworksData!
    ).supportedNetworks;
  }

  // get the current step we're in
  const step = inMemoryCache.get(senderAddress);

  if (!step) {
    // send the first message
    await context.reply("Hey! I can assist you in obtaining testnet tokens.");

    const channelsWithBalance = supportedNetworks
      .filter((n) => parseFloat(n.balance) > 0)
      .map((n) => `- ${n.networkId}`);
    const channelsWithoutBalance = supportedNetworks
      .filter((n) => parseFloat(n.balance) === 0)
      .map((n) => `- ${n.networkId}`);

    // send the second message
    await context.reply(
      `Here the options you can choose from (make sure to copy and paste the name exactly!):\n\n✅With Balance:\n${channelsWithBalance.join(
        "\n"
      )}\n\n❌Without Balance:\n${channelsWithoutBalance.join("\n")}`
    );

    inMemoryCache.set(senderAddress, 1);
  } else if (step === 1) {
    const inputNetwork = content.trim().toLowerCase().replace(" ", "_");
    if (!supportedNetworks.map((n) => n.networkId).includes(inputNetwork)) {
      await context.reply(
        `❌ I'm sorry, but I don't support ${content} at the moment. Can I assist you with a different testnet?`
      );
      return;
    }

    /* UNCOMMENT TO ADD A CUSTOM COOLDOWN TIME PER USER, LEARN WEB3 HAS 24HRS DEFAULT
    const lastClaimedAt = await redisClient.get(
      `last-claimed-at-${senderAddress}`
    );
    // check if the user has claimed in the last X hours
    if (Number(lastClaimedAt) > Date.now() - CLAIM_EVERY) {
      await context.reply(
        "Sorry, your only allowed once every 24 hours. Try again later!"
      );
      return;
    }

    // store the user's preference
    await redisClient.set(`last-claimed-at-${senderAddress}`, Date.now());*/

    await context.reply(
      "Your testnet tokens are being processed. Please wait a moment for the transaction to process."
    );
    const network = supportedNetworks.find((n) => n.networkId === inputNetwork);
    const result = await learnWeb3Client.dripTokens(
      inputNetwork,
      senderAddress
    );

    if (!result.ok) {
      await context.reply(
        `❌ Sorry, there was an error processing your request:\n\n"${result.error!}"`
      );
      return;
    }

    await context.reply("Here's your transaction receipt:");
    await context.reply(
      `${FRAME_BASE_URL}?networkLogo=${
        network?.networkLogo
      }&networkName=${network?.networkName.replace(" ", "-")}&tokenName=${
        network?.tokenName
      }&amount=${network?.dripAmount}`
    );
    inMemoryCache.set(senderAddress, 0);
  }
});
