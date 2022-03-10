import chai, { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { solidity } from "ethereum-waffle";
import { BIGPublicSale__factory } from "../types/factories/BIGPublicSale__factory";
import { BIGPublicSale } from "../types/BIGPublicSale";
import { MyERC20__factory } from "../types/factories/MyERC20__factory";
import { MyERC20 } from "../types/MyERC20";

chai.use(solidity);
const { assert } = chai;

describe("BIGPublicSale", function () {
  let bigPublicSaleFactory: BIGPublicSale__factory;
  let bigPublicSale: BIGPublicSale;
  let myERC20Factory: MyERC20__factory;
  let myERC20: MyERC20;
  let admin: SignerWithAddress;
  let purchaser: SignerWithAddress;

  const TOTAL_ALLOCATION = ethers.utils.parseEther("6000000");
  const PURCHASE_AMOUNT = ethers.utils.parseEther("5500");
  const TGE_TIME = Date.now();

  console.log("TOTAL_ALLOCATION: ", TOTAL_ALLOCATION);
  console.log("PURCHASE_AMOUNT: ", PURCHASE_AMOUNT);
  console.log("TGE_TIME: ", TGE_TIME);

  beforeEach(async function () {
    // TGE_TIME = Date.now();

    [admin, purchaser] = await ethers.getSigners();

    myERC20Factory = <MyERC20__factory>(
      await ethers.getContractFactory("MyERC20")
    );
    myERC20 = <MyERC20>await myERC20Factory.deploy("JADELabs", "JAD");
    await myERC20.deployed();

    bigPublicSaleFactory = <BIGPublicSale__factory>(
      await ethers.getContractFactory("BIGPublicSale")
    );
    bigPublicSale = await bigPublicSaleFactory.deploy(
      myERC20.address,
      TGE_TIME
    );
    await bigPublicSale.deployed();
    await myERC20.mint(bigPublicSale.address, TOTAL_ALLOCATION);
    await bigPublicSale.addPurchasers([purchaser.address], [PURCHASE_AMOUNT]);
  });

  describe("Claim", function () {
    it("should not let purchaser claim before TGE-Release time", async () => {
      await expect(bigPublicSale.connect(purchaser).claim()).to.be.revertedWith(
        "BIGPublicSale: NO_AVAILABLE_CLAIM"
      );
    });

    it("should let purchaser claim TGE-Release amount", async () => {
      const tgeLockDuration = await bigPublicSale.TGE_RELEASE_LOCK_DURATION();
      const tgeReleasePercent = await bigPublicSale.TGE_RELEASE_PERCENT();
      const tgeReleaseAmount = PURCHASE_AMOUNT.mul(tgeReleasePercent).div(100);

      await ethers.provider.send("evm_mine", [
        tgeLockDuration.add(TGE_TIME).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, tgeReleaseAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        tgeReleaseAmount
      );
    });

    it("should let purchaser claim vesting periodly", async () => {
      const tgeLockDuration = await bigPublicSale.TGE_RELEASE_LOCK_DURATION();
      const tgeReleasePercent = await bigPublicSale.TGE_RELEASE_PERCENT();
      const tgeReleaseAmount = PURCHASE_AMOUNT.mul(tgeReleasePercent).div(100);
      const cliffDuration = await bigPublicSale.CLIFF_DURATION();
      const afterCliffTime = tgeLockDuration.add(TGE_TIME).add(cliffDuration);
      const period = await bigPublicSale.PERIOD();
      const periodicVestingTimes = await bigPublicSale.PERIODIC_VESTING_TIMES();
      const periodicVestingAmount = PURCHASE_AMOUNT
        .sub(tgeReleaseAmount)
        .div(periodicVestingTimes);

      const tgeReleaseAndFirstVestingAmount =
        periodicVestingAmount.add(tgeReleaseAmount);

      const secondVestingAmount = periodicVestingAmount;
      const thirdVestingAmount = periodicVestingAmount;
      const fourthVestingAmount = periodicVestingAmount;

      console.log("TGE-Release and first vesting");
      await ethers.provider.send("evm_mine", [
        afterCliffTime.add(period).toNumber(),
      ]);      
      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, tgeReleaseAndFirstVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        tgeReleaseAndFirstVestingAmount
      );

      console.log("Second vesting");
      await ethers.provider.send("evm_mine", [
        afterCliffTime.add(period.mul(2)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, secondVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        tgeReleaseAndFirstVestingAmount.add(secondVestingAmount)
      );

      console.log("Third vesting");
      await ethers.provider.send("evm_mine", [
        afterCliffTime.add(period.mul(3)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, thirdVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        tgeReleaseAndFirstVestingAmount
          .add(secondVestingAmount)
          .add(thirdVestingAmount)
      );

      console.log("Fourth vesting");
      await ethers.provider.send("evm_mine", [
        afterCliffTime.add(period.mul(4)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, fourthVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        tgeReleaseAndFirstVestingAmount
          .add(secondVestingAmount)
          .add(thirdVestingAmount)
          .add(fourthVestingAmount)
      );
    });
  });
});
