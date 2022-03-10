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

    uint8 public status = 0;

    uint256 public constant PERIOD = 30 days;
    uint256 public TGE_RELEASE_LOCK_DURATION = 2 hours; // 2 hours
    uint256 public TGE_RELEASE_PERCENT = 20; // 20%
    uint256 public CLIFF_DURATION = 30 days; // 1 month
    uint256 public PERIODIC_VESTING_TIMES = 4; // vest monthly in 4 months
    uint256 public TOTAL_ALLOCATION = 6000000 ether;

    IERC20 public token;
    uint256 public tgeTime;

    uint256 public totalPurchasedAmount;
    uint256 public totalClaimedAmount;
    mapping(address => Purchase) public purchases;
    address[] public purchasers;

    event Claimed(address claimer, uint256 amount);

    constructor(address _token, uint256 _tgeTime) {
        token = IERC20(_token);
        tgeTime = _tgeTime;
    }

    modifier canSet() {
        require(status == 0, "BIGPublicSale: CANNOT_SET");
        _;
    }

    function setToken(address _token) external onlyOwner canSet {
        token = IERC20(_token);
    }

    function setTGETime(uint256 _tgeTime) external onlyOwner canSet {
        tgeTime = _tgeTime;
    }

    function setPurchasedAmount(address purchaser, uint256 amount)
        external
        onlyOwner
        canSet
    {
        purchases[purchaser].purchasedAmount = amount;
    }

    function stopSet() external onlyOwner canSet {
        status = 1;
    }

    function claim() external {
        require(tgeTime > 0, "BIGPublicSale: CANNOT_CLAIM_NOW");
        require(
            purchases[_msgSender()].purchasedAmount > 0,
            "BIGPublicSale: NOT_PURCHASER"
        );

        uint256 claimAmount = calcClaimAmount(_msgSender());
        console.log(
            "BIGPublicSale - claim(): claimAmount: %s ether ",
            claimAmount.div(1 ether)
        );

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
        console.log("BIGPublicSale - calcClaimAmount(): tgeTime: %s", tgeTime);
        console.log(
            "BIGPublicSale - calcClaimAmount(): TGE_RELEASE_LOCK_DURATION: %s",
            TGE_RELEASE_LOCK_DURATION
        );
        // before TGE release time
        if (block.timestamp < tgeReleaseTime) {
            console.log(
                "BIGPublicSale - calcClaimAmount(): block.timestamp < tgeReleaseTime, %s < %s",
                block.timestamp,
                tgeReleaseTime
            );
            return 0;
        }

        uint256 tgeReleaseAmount = purchase
            .purchasedAmount
            .mul(TGE_RELEASE_PERCENT)
            .div(100);
        // by the time after cliff duration from TGE release time, i.e. right before vesting time
        uint256 afterCliffTime = tgeReleaseTime.add(CLIFF_DURATION);
        console.log(
            "BIGPublicSale - calcClaimAmount(): tgeReleaseTime: %s",
            tgeReleaseTime
        );
        console.log(
            "BIGPublicSale - calcClaimAmount(): CLIFF_DURATION: %s",
            CLIFF_DURATION
        );
        if (block.timestamp <= afterCliffTime) {
            console.log(
                "BIGPublicSale - calcClaimAmount(): block.timestamp <= afterCliffTime, %s <= %s",
                block.timestamp,
                afterCliffTime
            );
            return tgeReleaseAmount - purchase.claimedAmount;
        }

        console.log(
            "BIGPublicSale - calcClaimAmount(): block.timestamp > afterCliffTime, %s > %s",
            block.timestamp,
            afterCliffTime
        );
        // begin vesting time
        uint256 totalClaimAmount = tgeReleaseAmount;
        uint256 nPeriods = uint256(block.timestamp).sub(afterCliffTime).div(
            PERIOD
        );
        if (nPeriods > 4) nPeriods = 4;

        console.log("BIGPublicSale - calcClaimAmount(): PERIOD: %s", PERIOD);
        console.log(
            "BIGPublicSale - calcClaimAmount(): nPeriods: %s",
            nPeriods
        );
        uint256 periodicVestingAmount = purchase
            .purchasedAmount
            .sub(tgeReleaseAmount)
            .div(PERIODIC_VESTING_TIMES);
        uint256 toDateVestingAmount = nPeriods.mul(periodicVestingAmount);
        totalClaimAmount = totalClaimAmount.add(toDateVestingAmount);
        // if (totalClaimAmount > purchase.purchasedAmount)
        //     totalClaimAmount = purchase.purchasedAmount;

        return totalClaimAmount - purchase.claimedAmount;
    }

    function addPurchasers(
        address[] calldata _purchasers,
        uint256[] calldata _amounts
    ) external onlyOwner {
        require(
            _purchasers.length == _amounts.length,
            "BIGPublicSale: INVALID_INPUT_DATA"
        );

        for (uint256 i = 0; i < _purchasers.length; i++) {
            uint256 purchasedAmount = purchases[_purchasers[i]].purchasedAmount;
            if (purchasedAmount > 0) {
                purchases[_purchasers[i]].purchasedAmount = purchasedAmount.add(
                    _amounts[i]
                );
            } else {
                purchases[_purchasers[i]].purchasedAmount = _amounts[i];
                purchasers.push(_purchasers[i]);
            }
            totalPurchasedAmount.add(_amounts[i]);
        }
    }

    function getAllPurchasers() public view returns (address[] memory) {
        return purchasers;
    }
}
