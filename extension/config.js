// Where the extension looks for the backend.
//
// This is the one file that differs between running it yourself and handing it
// to someone else. On your own machine the backend is on localhost. For anyone
// else, it has to be a server they can actually reach - their 127.0.0.1 is
// their own computer, not yours, so an unedited copy silently fails for every
// friend who installs it.
//
// If you change this to a hosted URL, add that same origin to host_permissions
// in manifest.json, or Chrome blocks the requests before they are sent.
const SECOND_BRAIN_API_BASE_URL = "http://127.0.0.1:3737";
