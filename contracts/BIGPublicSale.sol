// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

contract BIGPublicSale is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct Purchase {
        uint256 purchasedAmount;
        uint256 claimedAmount;
    }

    uint256 public constant PERIOD = 30 days;
    uint256 public TGE_RELEASE_LOCK_DURATION = 2 hours; // 2 hours
    uint256 public TGE_RELEASE_PERCENT = 20; // 20%
    uint256 public CLIFF_DURATION = 30 days; // 1 month
    uint256 public PERIODIC_VESTING_TIMES = 4; // vest monthly in 4 months
    uint256 public TOTAL_ALLOCATION = 6000000 ether;

    IERC20 public token;
    uint256 public tgeTime;
    uint256 public saleStartTime;
    uint256 public saleEndTime;
    uint256 public minPurchaseAmount;
    uint256 public maxPurchaseAmount;
    uint256 public inBNBPrice;

    uint256 public totalPurchasedAmount;
    uint256 public totalClaimedAmount;
    mapping(address => Purchase) public purchases;
    mapping(address => bool) public whitelist;

    event Purchased(address purchaser, uint256 amount);
    event Claimed(address claimer, uint256 amount);

    constructor(
        address _token,
        uint256 _tgeTime,
        uint256 _saleStartTime,
        uint256 _saleEndTime,
        uint256 _minPurchaseAmount,
        uint256 _maxPurchaseAmount,
        uint256 _inBNBPrice
    ) {
        token = IERC20(_token);
        tgeTime = _tgeTime;
        saleStartTime = _saleStartTime;
        saleEndTime = _saleEndTime;
        minPurchaseAmount = _minPurchaseAmount;
        maxPurchaseAmount = _maxPurchaseAmount;
        inBNBPrice = _inBNBPrice;
    }

    function purchaseInBNB() external payable {
        console.log(
            "BIGPublicSale - purchaseInBNB(): current timestamp: ",
            block.timestamp
        );

        require(
            totalPurchasedAmount < TOTAL_ALLOCATION,
            "BIGPublicSale: OUT_OF_ALLOCATION"
        );
        require(
            block.timestamp >= saleStartTime && block.timestamp <= saleEndTime,
            "BIGPublicSale: NOT_IN_OCCURING_TIME"
        );
        require(whitelist[_msgSender()], "BIGPublicSale: NOT_WHITELISTED");

        uint256 purchaseAmount = calcInBNBPurchaseAmount(msg.value);
        console.log(
            "BIGPublicSale - purchaseInBNB(): purchaseAmount: ",
            purchaseAmount
        );
        require(
            purchaseAmount >= minPurchaseAmount,
            "BIGPublicSale: UNDER_MIN_AMOUNT"
        );
        require(
            purchaseAmount <= maxPurchaseAmount,
            "BIGPublicSale: EXCEED_MAX_AMOUNT"
        );

        purchases[_msgSender()].purchasedAmount = purchases[_msgSender()]
            .purchasedAmount
            .add(purchaseAmount);
        totalPurchasedAmount.add(purchaseAmount);

        emit Purchased(_msgSender(), purchaseAmount);
    }

    function calcInBNBPurchaseAmount(uint256 bnbAmount)
        public
        view
        returns (uint256)
    {
        return bnbAmount.div(inBNBPrice).mul(1 ether);
    }

    function claim() external {
        require(tgeTime > 0, "BIGPublicSale: CANNOT_CLAIM_NOW");
        require(
            purchases[_msgSender()].purchasedAmount > 0,
            "BIGPublicSale: NOT_PURCHASER"
        );

        uint256 claimAmount = calcClaimAmount(_msgSender());
        console.log("BIGPublicSale - claim(): claimAmount: ", claimAmount);

        require(claimAmount > 0, "BIGPublicSale: NO_AVAILABLE_CLAIM");

        purchases[_msgSender()].claimedAmount = purchases[_msgSender()]
            .claimedAmount
            .add(claimAmount);
        token.transfer(_msgSender(), claimAmount);

        emit Claimed(_msgSender(), claimAmount);
    }

    // timeline
    // TGE time -------------------------> TGE release ----------------------> After cliff (start vesting) --------------> 1st vesting --------------> 2nd vesting --------------> ...
    // ------------|TGE lock duration|--------------------|Cliff duration|------------------------------------|Period|-------------------|Period|--------------------|Period|---- ...
    function calcClaimAmount(address purchaser) public view returns (uint256) {
        Purchase memory purchase = purchases[purchaser]; // gas saving

        uint256 tgeReleaseTime = tgeTime.add(TGE_RELEASE_LOCK_DURATION);
        // before TGE release time
        if (block.timestamp < tgeReleaseTime) {
            console.log(
                "BIGPublicSale - calcClaimAmount(): block.timestamp < tgeReleaseTime"
            );
            return 0;
        }

        uint256 tgeReleaseAmount = purchase
            .purchasedAmount
            .mul(TGE_RELEASE_PERCENT)
            .div(100);
        // by the time after cliff duration from TGE release time, i.e. right before vesting time
        uint256 cliffTime = tgeReleaseTime.add(CLIFF_DURATION);
        if (block.timestamp <= cliffTime) {
            console.log(
                "BIGPublicSale - calcClaimAmount(): block.timestamp <= cliffTime"
            );
            return tgeReleaseAmount - purchase.claimedAmount;
        }

        // begin vesting time
        uint256 totalClaimAmount = tgeReleaseAmount;
        uint256 nPeriods = uint256(block.timestamp).sub(cliffTime).div(PERIOD);

        uint256 periodicVestingAmount = purchase
            .purchasedAmount
            .sub(tgeReleaseAmount)
            .div(PERIODIC_VESTING_TIMES);
        uint256 toDateVestingAmount = nPeriods.mul(periodicVestingAmount);
        totalClaimAmount = totalClaimAmount.add(toDateVestingAmount);
        if (totalClaimAmount > purchase.purchasedAmount)
            totalClaimAmount = purchase.purchasedAmount;

        return totalClaimAmount - purchase.claimedAmount;
    }

    function addWhitelist(address[] calldata purchasers) external onlyOwner {
        for (uint256 i = 0; i < purchasers.length; i++) {
            whitelist[purchasers[i]] = true;
        }
    }
}
