/**
 * Fluence CLI
 * Copyright (C) 2024 Fluence DAO
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { color } from "@oclif/color";

import {
  ccDurationValidator,
  getMinCCDuration,
  validateAddress,
} from "./chain/chainValidators.js";
import { isInteractive } from "./commandObj.js";
import type { ProviderConfig } from "./configs/project/provider/provider.js";
import type { Offer } from "./configs/project/provider/provider2.js";
import {
  defaultNumberProperties,
  type CurrencyProperty,
  currencyProperties,
  DEFAULT_CC_STAKER_REWARD,
  DURATION_EXAMPLE,
  DEFAULT_NUMBER_OF_COMPUTE_UNITS_ON_NOX,
} from "./const.js";
import { bigintToStr, numToStr } from "./helpers/typesafeStringify.js";
import { commaSepStrToArr } from "./helpers/utils.js";
import {
  validatePercent,
  validatePositiveNumberOrEmpty,
} from "./helpers/validations.js";
import { checkboxes, confirm, input } from "./prompt.js";

async function promptToSetNumberProperty(
  offer: Offer,
  property: CurrencyProperty,
) {
  const propertyStr = await input({
    message: `Enter ${color.yellow(property)}`,
    default: defaultNumberProperties[property],
  });

  offer[property] = propertyStr;
}

const DEFAULT_NUMBER_OF_NOXES = 3;

export type ProviderConfigArgs = {
  noxes?: number | undefined;
  "no-vm"?: boolean | undefined;
};

export async function addComputePeers(
  numberOfNoxes: number | undefined,
  providerConfig: ProviderConfig,
) {
  let computePeersCounter = 0;
  let isAddingMoreComputePeers = true;
  const minDuration = await getMinCCDuration();
  const validateCCDuration = await ccDurationValidator();

  do {
    const defaultName = `nox-${numToStr(computePeersCounter)}`;

    let name =
      numberOfNoxes === undefined
        ? await input({
            message: `Enter name for compute peer`,
            default: defaultName,
          })
        : defaultName;

    if (name === defaultName) {
      name = defaultName;
      computePeersCounter = computePeersCounter + 1;
    }

    const computeUnitsString = await input({
      message: `Enter number of compute units for ${color.yellow(name)}`,
      default: numToStr(DEFAULT_NUMBER_OF_COMPUTE_UNITS_ON_NOX),
      validate: validatePositiveNumberOrEmpty,
    });

    const capacityCommitmentDuration = await input({
      message: `Enter capacity commitment duration ${DURATION_EXAMPLE}`,
      default: `${bigintToStr(minDuration)} sec`,
      validate: validateCCDuration,
    });

    const capacityCommitmentDelegator = await input({
      // default: anybody can activate capacity commitment
      // optional
      message: `Enter capacity commitment delegator address`,
      validate: validateAddress,
    });

    const capacityCommitmentStakerReward = await input({
      message: `Enter capacity commitment staker reward (in %)`,
      default: numToStr(DEFAULT_CC_STAKER_REWARD),
      validate: validatePercent,
    });

    providerConfig.capacityCommitments[name] = {
      duration: capacityCommitmentDuration,
      delegator: capacityCommitmentDelegator,
      stakerReward: Number(capacityCommitmentStakerReward),
    };

    providerConfig.computePeers[name] = {
      computeUnits: Number(computeUnitsString),
    };

    if (numberOfNoxes !== undefined) {
      isAddingMoreComputePeers = numberOfNoxes > computePeersCounter;
      continue;
    }

    if (isInteractive) {
      isAddingMoreComputePeers = await confirm({
        message: "Do you want to add more compute peers",
      });

      continue;
    }

    isAddingMoreComputePeers = DEFAULT_NUMBER_OF_NOXES > computePeersCounter;
  } while (isAddingMoreComputePeers);
}

export async function addOffers(providerConfig: ProviderConfig) {
  let isAddingMoreOffers = true;
  let offersCounter = 0;

  do {
    const defaultName =
      offersCounter === 0 ? "offer" : `offer-${numToStr(offersCounter)}`;

    const name = await input({
      message: `Enter name for offer`,
      default: defaultName,
    });

    if (name === defaultName) {
      offersCounter = offersCounter + 1;
    }

    const computePeerOptions = Object.keys(providerConfig.computePeers);

    const computePeers = isInteractive
      ? await checkboxes({
          message: `Select compute peers for ${color.yellow(name)}`,
          options: computePeerOptions,
          validate: (choices: string[]) => {
            if (choices.length === 0) {
              return "Please select at least one compute peer";
            }

            return true;
          },
          oneChoiceMessage(choice) {
            return `Do you want to select ${color.yellow(choice)} compute peer`;
          },
          onNoChoices() {
            throw new Error("No compute peers selected");
          },
        })
      : computePeerOptions;

    const effectorsString = await input({
      message: "Enter comma-separated list of effector CIDs",
      default: "",
    });

    const effectors =
      effectorsString === "" ? [] : commaSepStrToArr(effectorsString);

    const offer: Offer = {
      ...defaultNumberProperties,
      computePeers,
      ...(effectors.length > 0 ? { effectors } : {}),
    };

    for (const numberProperty of currencyProperties) {
      await promptToSetNumberProperty(offer, numberProperty);
    }

    providerConfig.offers[name] = offer;

    isAddingMoreOffers = await confirm({
      message: "Do you want to add more offers",
      default: false,
    });
  } while (isAddingMoreOffers);
}
