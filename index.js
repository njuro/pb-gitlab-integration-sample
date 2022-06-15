const express = require("express");
const bodyParser = require("body-parser"); // Parses JSON bodies
const cookieParser = require("cookie-parser");
const app = express().use(bodyParser.text());
const port = process.env.PORT || 3000;
const axios = require("axios"); // Helps by sending HTTP for us

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Productboard and GitLab info here
const pbIntegrationID = process.env.PB_INTEGRATION_ID; // Add the Productboard plugin integration ID here
const gitlabToken = process.env.GITLAB_TOKEN; // Add your Gitlab token here
const productboardToken = process.env.PB_TOKEN; // Add the Productboard API token here to authorize requests

app.get("/", (req, res) => {
	res.send(
		"This is a Heroku server hosting our Productboard <> GitLab integration"
	);
});

app.get("/plugin", (req, res) => {
	res.setHeader("Content-type", "text/plain");
	res.status(200).send(res.req.query.validationToken);
});

app.get("/productboard-webhook", async (req, res) => {
	res.setHeader("Content-type", "text/plain");
	res.status(200).send(res.req.query.validationToken);
});

// Endpoint where POST requests from Productboard plugin will be sent
app.post("/plugin", async (req, res) => {
	// Gather information about the feature that is sending over request
	const pbFeatureID = res.req.body.data.feature.id;
	const pbIntegrationID = res.req.body.data.integrationId;
	const pbFeatureLink = res.req.body.data.feature.links.html;

	console.log("Productboard trigger is:", req.body.data.trigger);

	// Determine action on button trigger. Can be push, dismiss, or unlink.
	if (req.body.data.trigger === "button.push") {
		res.json({
			data: {
				connection: {
					state: "progress",
				},
			},
		});

		// Setup request to access information of feature being pushed
		const pbFeatureInfo = {
			method: "get",
			url: `https://api.productboard.com/features/${pbFeatureID}`,
			headers: {
				"X-Version": "1",
				Authorization: productboardToken,
			},
		};

		// Access information of Productboard feature being pushed
		axios(pbFeatureInfo)
			.then(function (pbFeatureResponse) {
				console.log("Feature data is:", pbFeatureResponse.data.data.name);

				//Take Productboard data and map it to Gitlab issue fields. Will be sent later.
				const gitlabData = JSON.stringify({
					title: pbFeatureResponse.data.data.name,
					description:
						pbFeatureResponse.data.data.description +
						`<br><strong>Click <a href="${pbFeatureLink}">here</a> to see feature in Productboard</strong>`,
				});

				// Setup request to send data to Gitlab
				const gitlabConfig = {
					method: "post",
					url: "https://gitlab.com/api/v4/projects/35858336/issues",
					headers: {
						"PRIVATE-TOKEN": gitlabToken,
						"Content-Type": "application/json",
					},
					data: gitlabData,
				};

				// Send data to Gitlab
				axios(gitlabConfig)
					.then(function (response) {
						// Send data back to plugin connection in Productboard
						const gitlabIssueId = response.data.id;
						const gitlabIssueURL = response.data.web_url;

						// Setup Productboard plugin connection with information from Gitlab
						const pbPluginIntegrationData = JSON.stringify({
							data: {
								connection: {
									state: "connected",
									label: "Opened",
									hoverLabel: `Issue ${gitlabIssueId}`,
									tooltip: `Issue ${gitlabIssueId}`,
									color: "blue",
									targetUrl: gitlabIssueURL,
								},
							},
						});

						// Additional setup for PB update of plugin integration connection
						const pbIntegrationConfig = {
							method: "put",
							url: `https://api.productboard.com/plugin-integrations/${pbIntegrationID}/connections/${pbFeatureID}`,
							headers: {
								"X-Version": "1",
								Authorization: productboardToken,
								"Content-Type": "application/json",
							},
							data: pbPluginIntegrationData,
						};

						// Update of PB plugin integration connection
						axios(pbIntegrationConfig)
							.then(function (response) {
								console.log("Feature connected to Gitlab.");
							})
							.catch(function (error) {
								console.log(error.message);
							});
					})
					.catch(function (error) {
						console.log("Error when creating GitLab issue:", error);
					});
			})
			.catch(function (error) {
				console.log("Error when getting Productboard feature:", error);
			});
		res.status(200).end();

		// If button trigger is cancel or dismiss, set PB plugin connection to initial state (basically disconnected)
	} else {
		res.json({
			data: {
				connection: {
					state: "initial",
				},
			},
		});
		res.status(200).end();
		console.log("Feature is unlinked");
	}
});

// Handle updates from Gitlab for status updates in plugin integration column
app.post("/gitlab-webhook", async (req, res) => {
	const gitlabIssueId = req.body.object_attributes.id;
	const gitlabIssueStatus = req.body.object_attributes.state;
	const gitlabIssueURL = req.body.object_attributes.url;

	console.log(
		"The issue ID is:",
		gitlabIssueId,
		"and the state is:",
		gitlabIssueStatus
	);
	const pbTooltip = "Issue " + gitlabIssueId;
	let pbTooltipColor = "";

	// Update plugin integration column color depending on Gitlab status
	if (gitlabIssueStatus === "opened") {
		pbTooltipColor = "blue";
	} else {
		pbTooltipColor = "green";
	}

	// Setup update of plugin integration connection
	var pbIntegrationConfig = {
		method: "get",
		url: `https://api.productboard.com/plugin-integrations/${pbIntegrationID}/connections/`,
		headers: {
			"X-Version": "1",
			Authorization: productboardToken,
			"Content-Type": "application/json",
		},
	};

	const pbBaseURL = "https://api.productboard.com";
	let offset = 0;
	let featureResult = [];

	// Loop through features in PB to find the right feature based Gitlab issue ID
	axios(pbIntegrationConfig)
		.then(function (response) {
			featureResult = response.data.data.filter((obj) => {
				return obj.connection.tooltip === pbTooltip;
			});
			console.log(
				"Feature result is",
				featureResult,
				"and its length is",
				featureResult.length
			);

			const pbUpdateFromGitlabData = JSON.stringify({
				data: {
					connection: {
						state: "connected",
						label: gitlabIssueStatus,
						hoverLabel: `Issue ${gitlabIssueId}`,
						tooltip: `Issue ${gitlabIssueId}`,
						color: pbTooltipColor,
						targetUrl: gitlabIssueURL,
					},
				},
			});

			// Once feature is found, setup the request to update the plugin integration connection in PB
			const pbFeatureID = featureResult[0].featureId;
			var pbPluginUpdate = {
				method: "put",
				url: `https://api.productboard.com/plugin-integrations/${pbIntegrationID}/connections/${pbFeatureID}`,
				headers: {
					"X-Version": "1",
					Authorization: productboardToken,
					"Content-Type": "application/json",
				},
				data: pbUpdateFromGitlabData,
			};

			// When a match between the Gitlab issue and PB feature is found, a status update is sent to the to the PB feature based on the status of the Gitlab issue
			if (featureResult.length === 1) {
				console.log("PB Feature ID is", pbFeatureID);
				axios(pbPluginUpdate).then(function (response) {
					console.log(
						`Productboard feature status in plugin column is now:`,
						gitlabIssueStatus,
						"🚀"
					);
				});
			}
		})
		.catch(function (err) {
			console.log("PB Gitlab connections GET call error:", err);
		});
});

app.listen(port, () => {
	console.log(
		`GitLab integration is listening on port http://localhost:${port}`
	);
});
