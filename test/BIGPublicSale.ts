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

  let _saleStartTime;
  let _saleEndTime;
  let _tgeTime: number;
  // const _saleStartTime = Date.now();
  // const _saleEndTime = _saleStartTime + 60 * 60 * 24 * 2; // 2 days after _saleStartTime
  // const _tgeTime = _saleEndTime + 60 * 60 * 24 * 2; // 2 days after _saleEndTime
  const _minPurchaseAmount = ethers.utils.parseEther("1500");
  const _maxPurchaseAmount = ethers.utils.parseEther("6000");
  const _inBNBPrice = ethers.utils.parseEther("0.00013");
  const _minPurchaseBNBAmount = _minPurchaseAmount
    .mul(_inBNBPrice)
    .div(ethers.utils.parseEther("1"));
  const _maxPurchaseBNBAmount = _maxPurchaseAmount
    .mul(_inBNBPrice)
    .div(ethers.utils.parseEther("1"));

  // console.log("_saleStartTime: ", _saleStartTime);
  // console.log("_saleEndTime: ", _saleEndTime);
  // console.log("_tgeTime: ", _tgeTime);
  console.log("_minPurchaseAmount: ", _minPurchaseAmount);
  console.log("_maxPurchaseAmount: ", _maxPurchaseAmount);
  console.log("_minPurchaseBNBAmount: ", _minPurchaseBNBAmount);
  console.log("_maxPurchaseBNBAmount: ", _maxPurchaseBNBAmount);

  // async trick in describe function
  // it("", async () => {
  //   await ethers.provider.send("evm_mine", [_saleStartTime]);
  // });

  beforeEach(async function () {
    _saleStartTime = (await ethers.provider.getBlock("latest")).timestamp;
    _saleEndTime = _saleStartTime + 60 * 60 * 24 * 2; // 2 days after _saleStartTime
    _tgeTime = _saleEndTime + 60 * 60 * 24 * 2; // 2 days after _saleEndTime

    // console.log("_saleStartTime: ", _saleStartTime);
    // console.log("_saleEndTime: ", _saleEndTime);
    // console.log("_tgeTime: ", _tgeTime);

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
      _tgeTime,
      _saleStartTime,
      _saleEndTime,
      _minPurchaseAmount,
      _maxPurchaseAmount,
      _inBNBPrice
    );
    await bigPublicSale.deployed();
    await myERC20.mint(bigPublicSale.address, _maxPurchaseAmount);

    await bigPublicSale.addWhitelist([purchaser.address]);
    // await ethers.provider.send("evm_setNextBlockTimestamp", [_saleStartTime]);
    // await ethers.provider.send("evm_mine", [_saleStartTime]);
  });

  describe("Purchase", function () {
    it("should let whitelisted user purchase token", async () => {
      await expect(
        bigPublicSale
          .connect(purchaser)
          .purchaseInBNB({ value: _minPurchaseBNBAmount })
      ).to.emit(bigPublicSale, "Purchased");

      expect(
        (await bigPublicSale.purchases(purchaser.address)).purchasedAmount
      ).to.equal(_minPurchaseAmount);
    });
  });

  describe("Claim", function () {
    beforeEach(async function () {
      await bigPublicSale
        .connect(purchaser)
        .purchaseInBNB({ value: _minPurchaseBNBAmount });
    });

    it("should not let purchaser claim before TGE-Release time", async () => {
      await expect(bigPublicSale.connect(purchaser).claim()).to.be.revertedWith(
        "BIGPublicSale: NO_AVAILABLE_CLAIM"
      );
    });

    it("should let purchaser claim TGE-Release amount", async () => {
      const tgeLockDuration = await bigPublicSale.TGE_RELEASE_LOCK_DURATION();
      const tgeReleasePercent = await bigPublicSale.TGE_RELEASE_PERCENT();
      const tgeReleaseAmount = _minPurchaseAmount
        .mul(tgeReleasePercent)
        .div(100);

      await ethers.provider.send("evm_mine", [
        tgeLockDuration.add(_tgeTime).toNumber(),
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
      const tgeReleaseAmount = _minPurchaseAmount
        .mul(tgeReleasePercent)
        .div(100);
      const cliffDuration = await bigPublicSale.CLIFF_DURATION();
      const vestingTime = tgeLockDuration.add(_tgeTime).add(cliffDuration);
      const period = await bigPublicSale.PERIOD();
      const periodicVestingTimes = await bigPublicSale.PERIODIC_VESTING_TIMES();
      const periodicVestingAmount = _minPurchaseAmount
        .sub(tgeReleaseAmount)
        .div(periodicVestingTimes);

      const firstVestingAmountIncludedTGE =
        periodicVestingAmount.add(tgeReleaseAmount);

      const secondVestingAmount = periodicVestingAmount;
      const thirdVestingAmount = periodicVestingAmount;
      const fourthVestingAmount = periodicVestingAmount;

      await ethers.provider.send("evm_mine", [
        vestingTime.add(period).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, firstVestingAmountIncludedTGE);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        firstVestingAmountIncludedTGE
      );

      await ethers.provider.send("evm_mine", [
        vestingTime.add(period.mul(2)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, secondVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        firstVestingAmountIncludedTGE.add(secondVestingAmount)
      );

      await ethers.provider.send("evm_mine", [
        vestingTime.add(period.mul(3)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, thirdVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        firstVestingAmountIncludedTGE
          .add(secondVestingAmount)
          .add(thirdVestingAmount)
      );

      await ethers.provider.send("evm_mine", [
        vestingTime.add(period.mul(4)).toNumber(),
      ]);

      await expect(bigPublicSale.connect(purchaser).claim())
        .to.emit(bigPublicSale, "Claimed")
        .withArgs(purchaser.address, fourthVestingAmount);

      expect(await myERC20.balanceOf(purchaser.address)).to.equal(
        firstVestingAmountIncludedTGE
          .add(secondVestingAmount)
          .add(fourthVestingAmount)
      );
    });
  });
});
