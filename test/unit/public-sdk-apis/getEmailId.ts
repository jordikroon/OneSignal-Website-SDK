import "../../support/polyfills/polyfills";
import test from "ava";
import Database from "../../../src/services/Database";
import Macros from "../../support/tester/Macros";
import {TestEnvironment} from "../../support/sdk/TestEnvironment";
import OneSignal from "../../../src/OneSignal";
import { Subscription } from '../../../src/models/Subscription';

import { EmailProfile } from "../../../src/models/EmailProfile";
import Random from "../../support/tester/Random";


test("getEmailId should return the correct string", async t => {
  await TestEnvironment.initialize();
  const emailProfile = new EmailProfile();
  emailProfile.emailId = Random.getRandomUuid();
  await OneSignal.database.setEmailProfile(emailProfile);
  const emailIdByPromise = await OneSignal.getEmailId()
  const emailIdByCallback = await new Promise(resolve => {
    OneSignal.getEmailId(resolve)
  });
  t.is(emailIdByPromise, emailProfile.emailId);
  t.is(emailIdByCallback, emailProfile.emailId);
});
