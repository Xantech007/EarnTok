EarnTok, watch to earn

## Video feed and administration

The public feed in `index.html` reads documents from the Firestore `videos` collection where `admin` is `"yes"`. Each document uses its Firestore document ID as the video ID and supports these fields:

- `link`: Cloudinary video URL
- `mediaType`: `"video"` or `"image"`; older documents without this field are treated as videos
- `description`: video caption
- `likesCount`, `savesCount`, `sharesCount`: numeric counters
- `comments`: array of comment strings or comment objects
- `uploadedBy`: creator name
- `profileImageLink`: Cloudinary profile-image URL
- `admin`: `"yes"` to include the video in the public feed

## Superadmin

Open `superadmin.html` to upload and manage media. The sign-in page compares the entered `username` and `password` with the `admin/login` Firestore document. Admin uploads saved as drafts use cloud `hjkjnzpz` and preset `pending_review`; publishing transfers those assets to cloud `s35mxosr` using preset and folder `user_uploads`. Admin uploads published immediately go directly to the publishing cloud.

The admin page manages every field listed above, including counters, comments, and published/draft visibility. Deleting a video removes its Firestore document; the unsigned Cloudinary configuration cannot delete the uploaded asset. Its credential check runs in the browser and is only a UI gate; it does not secure Firestore. Do not rely on it for authorization. Protect the database with restrictive Firestore Security Rules and a server-enforced authentication design before using it with sensitive or production data.

## User accounts and feed activity

Users can browse and scroll the public feed without an account. Liking is also available while signed out; comments and other feed actions send users to `oauth.html` to log in or register. Email/password authentication must be enabled in Firebase Authentication. Registration stores the full name, username, email, phone number, and an initially empty `profilePic` in `users/{uid}` and reserves lowercase usernames in `usernames/{usernameLower}`. Signed-in users can upload photos or videos from their device or capture media from a camera in the create modal. Submissions upload to cloud `hjkjnzpz` using preset `pending_review`, then save in `videos` as drafts (`admin: "no"`) with zero counters and the user's username/profile picture.

When an admin publishes a creator draft, the source image or video is copied to cloud `s35mxosr` using preset and folder `user_uploads`; Firestore is updated to the new URL and the video is published only after transfer succeeds. Cloudinary assets uploaded to the review cloud are not automatically deleted after transfer.

Feed interactions are recorded as documents in `activity` with `videoId` when relevant, `userId`, `action`, `details`, and `createdAt`. Likes, saves, and shares update `likesCount`, `savesCount`, and `sharesCount` on the corresponding `videos/{videoId}` document; comments and comment likes update its `comments` array. Signed-out likes use a locally generated guest identifier. Configure Firestore Security Rules to allow public reads of published videos, validate activity writes and counter changes, reserve usernames safely, and restrict account data to its owner; client-side UI checks are not authorization.