import path from "path";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";


const generateAccessAndRefreshTokens = async(userId) =>
  {
  try {
    const user = await User.findById(userId)
    const accessToken = user.generateAccessToken()
    const refreshToken = user.generateRefreshToken()

    user.refreshToken = refreshToken
    await user.save({ validateBeforeSave: false })

    return {accessToken, refreshToken}

  } catch (error) {
    throw new ApiError(500, "Something went wrong while generating reference and Access token")
  }
}

// get user details from frontend
// validation - not empty
// check if user already exists - username, email
//check for image, check for avatar
// upload them to cloudinary, avatar
// create user object - create entry in DB
// remove password & refresh token field from response
// check for user creation
// return res

const registerUser = asyncHandler(async (req, res) => {
  console.log("req.body:", req.body);
  console.log("req.files:", req.files);

  const { fullname, email, username, password } = req.body;

  if ([fullname, email, username, password].some(f => f?.trim() === "")) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }

  const avatarLocalPath = req.files?.avatar?.[0]?.path
    ? path.resolve(req.files.avatar[0].path)
    : undefined;

    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path;
    }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  console.log("Cloudinary avatar:", avatar);

  const coverImage = coverImageLocalPath
    ? await uploadOnCloudinary(coverImageLocalPath)
    : null;

  if (!avatar?.url) {
    throw new ApiError(500, "Failed to upload avatar to Cloudinary");
  }

  const user = await User.create({
    fullname,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password, // hashed in pre-save hook
    username: username.toLowerCase(),
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering user");
  }

  return res.status(201).json(
    new ApiResponse(201, createdUser, "User registered successfully")
  );
});


// request body -> data
// username or email
// find the user
// password check
// access & refresh token generate
// send cookies
// return res 


const loginUser = asyncHandler(async (req, res) => {
  const {email, username, password} = req.body
  if(!username || !email){
    throw new ApiError(400, "Username or Email is required")
  }

  const user = await User.findOne({
    $or: [{username}, {email}],
  })

  if(!user){
    throw new ApiError(404, "User does not exist")
  }

  const isPasswordValid = await user.isPasswordCorrect(password)

  if(!isPasswordValid){
    throw new ApiError(401, "Invalid user Credentials")
  }

  const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

  const loggedInUser = User.findById(user._id).select("-password -refreshToken")

  const options = {
    httpOnly: true,
    secure: true
  }

  return res
  .status(200)
  .cookie("accessToken", accessToken, options)
  .cookie("refreshToken", refreshToken, options)
  .json(new ApiResponse(
    200,
    {
      user: loggedInUser, accessToken, refreshToken
    },
    "User logged in Successfully"
  ))

});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined
      }
    },
    {
      new: true
    }
  )

  const options = {
    httpOnly: true,
    secure: true
  }

  return res
  .status(200)
  .clearCookie("accessToken", options)
  .clearCookie("refreshToken", options)
  .json(new ApiResponse(200, {}, "User Logged Out"))

});

export { 
  registerUser,
  loginUser,
  logoutUser
};


