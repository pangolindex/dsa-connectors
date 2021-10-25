const hre = require("hardhat");
const { ethers } = hre;
const abis = require("./constant/abis");

module.exports = async function() {
  const [_, __, ___, wallet3] = await ethers.getSigners();
  const instaIndex = new ethers.Contract(
    "0x6CE3e607C808b4f4C26B7F6aDAeB619e49CAbb25",
    abis.core.instaIndex,
    wallet3
  );

  const masterAddress = await instaIndex.master(); // TODO: make it constant?
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [masterAddress],
  });
  await wallet3.sendTransaction({
    to: masterAddress,
    value: ethers.utils.parseEther("10"),
  });

  return await ethers.getSigner(masterAddress);
};
