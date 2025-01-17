const should = require('should') // eslint-disable-line
const setup = require('../../setup')

const FF_UTIL = require('flowforge-test-utils')
const { Roles } = FF_UTIL.require('forge/lib/roles')

describe('Billing', function () {
    let app

    function setupStripe (mock) {
        require.cache[require.resolve('stripe')] = {
            exports: function (apiKey) {
                return mock
            }
        }
    }

    afterEach(async function () {
        if (app) {
            await app.close()
            app = null
        }
        delete require.cache[require.resolve('stripe')]
    })
    describe('createSubscriptionSession', async function () {
        beforeEach(async function () {
            setupStripe({
                checkout: {
                    sessions: {
                        create: sub => JSON.parse(JSON.stringify(sub))
                    }
                }
            })
        })

        it('creates a session using default product/price', async function () {
            app = await setup({
                billing: {
                    stripe: {
                        key: 1234,
                        team_product: 'defaultteamprod',
                        team_price: 'defaultteamprice'
                    }
                }
            })

            const defaultTeamType = await app.db.models.TeamType.findOne()
            const newTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })

            const result = await app.billing.createSubscriptionSession(newTeam)

            result.should.have.property('mode', 'subscription')
            result.should.have.property('client_reference_id', newTeam.hashid)
            result.should.have.property('success_url', 'http://localhost:3000/team/new-team/overview?billing_session={CHECKOUT_SESSION_ID}')
            result.should.have.property('cancel_url', 'http://localhost:3000/team/new-team/overview')
            result.should.have.property('subscription_data')
            result.subscription_data.should.have.property('metadata')
            result.subscription_data.metadata.should.have.property('team', newTeam.hashid)
            result.should.have.property('line_items')
            result.line_items.should.have.length(1)
            result.line_items[0].should.have.property('price', 'defaultteamprice')
            result.line_items[0].should.have.property('quantity', 1)
        })

        it('creates a session using team type product/price', async function () {
            app = await setup({
                billing: {
                    stripe: {
                        key: 1234,
                        team_product: 'defaultteamprod',
                        team_price: 'defaultteamprice',
                        teams: {
                            starter: {
                                product: 'starterteamprod',
                                price: 'starterteampprice'
                            }
                        }
                    }
                }
            })

            const defaultTeamType = await app.db.models.TeamType.findOne()
            const newTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })
            await newTeam.reload({
                include: [{ model: app.db.models.TeamType }]
            })

            const result = await app.billing.createSubscriptionSession(newTeam)

            result.should.have.property('line_items')
            result.line_items.should.have.length(1)
            result.line_items[0].should.have.property('price', 'starterteampprice')
            result.line_items[0].should.have.property('quantity', 1)
        })

        it('creates a session using an existing stripe customer if the team has a subscription', async function () {
            app = await setup({
                billing: {
                    stripe: {
                        key: 1234,
                        team_product: 'defaultteamprod',
                        team_price: 'defaultteamprice'
                    }
                }
            })

            const defaultTeamType = await app.db.models.TeamType.findOne()
            const newTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })
            await app.db.controllers.Subscription.createSubscription(newTeam, 'existing-subscription', 'existing-customer')
            await newTeam.reload({
                include: [{ model: app.db.models.TeamType }]
            })

            const result = await app.billing.createSubscriptionSession(newTeam)

            result.should.have.property('customer', 'existing-customer')
            result.customer_update.should.have.property('name', 'auto')
        })

        describe('with free trials', function () {
            describe('configured', function () {
                beforeEach(async function () {
                    app = await setup({
                        billing: {
                            stripe: {
                                key: 1234,
                                team_product: 'defaultteamprod',
                                team_price: 'defaultteamprice',
                                new_customer_free_credit: 1000
                            }
                        }
                    })
                })

                it('sets the trial flag if the user is eligible for a trial', async function () {
                    const defaultTeamType = await app.db.models.TeamType.findOne()
                    const newTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })
                    const user = await app.db.models.User.create({ admin: true, username: 'new', name: 'New User', email: 'new@example.com', email_verified: true, password: 'aaPassword' })
                    await newTeam.addUser(user, { through: { role: Roles.Owner } })
                    should.equal(await app.db.controllers.Subscription.userEligibleForFreeTrial(user, true), true)

                    const result = await app.billing.createSubscriptionSession(newTeam, null, user)

                    result.should.have.property('subscription_data')
                    result.subscription_data.should.have.property('metadata')
                    result.subscription_data.metadata.should.have.property('free_trial', true)
                })

                it('sets trial flag to false if the user is not eligible for a trial', async function () {
                    const defaultTeamType = await app.db.models.TeamType.findOne()
                    const secondTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })
                    const userAlice = await app.db.models.User.byEmail('alice@example.com')
                    await secondTeam.addUser(userAlice, { through: { role: Roles.Owner } })
                    should.equal(await app.db.controllers.Subscription.userEligibleForFreeTrial(userAlice, true), false)

                    const result = await app.billing.createSubscriptionSession(secondTeam, null, userAlice)

                    result.should.have.property('subscription_data')
                    result.subscription_data.should.have.property('metadata')
                    result.subscription_data.metadata.should.have.property('free_trial', false)
                })
            })
        })

        describe('disabled', function () {
            beforeEach(async function () {
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice'
                            // new_customer_free_credit - NOT enabled
                        }
                    }
                })
            })

            it('does not set trial flag even if the user is eligible for a trial', async function () {
                const defaultTeamType = await app.db.models.TeamType.findOne()
                const newTeam = await app.db.models.Team.create({ name: 'new-team', TeamTypeId: defaultTeamType.id })
                const user = await app.db.models.User.create({ admin: true, username: 'new', name: 'New User', email: 'new@example.com', email_verified: true, password: 'aaPassword' })
                await newTeam.addUser(user, { through: { role: Roles.Owner } })
                should.equal(await app.db.controllers.Subscription.userEligibleForFreeTrial(user, true), true)

                const result = await app.billing.createSubscriptionSession(newTeam, null, user)

                result.should.have.property('subscription_data')
                result.subscription_data.should.have.property('metadata')
                result.subscription_data.metadata.should.not.have.property('free_trial')
                result.subscription_data.metadata.should.not.have.property('free_trial', true)
            })
        })
    })

    describe('updateTeamMemberCount', async function () {
        let updateId, updateData
        beforeEach(async function () {
            updateId = null
            updateData = null
            setupStripe({
                subscriptions: {
                    retrieve: async sub => {
                        return {
                            items: {
                                data: [
                                    { id: '123', quantity: 1, plan: { product: 'defaultteamprod' } },
                                    { id: '234', quantity: 27, plan: { product: 'starterteamprod' } }
                                ]
                            }
                        }
                    }
                },
                subscriptionItems: {
                    update: async (id, update) => {
                        updateId = id
                        updateData = update
                    }
                }
            })
        })
        it('does not update team subscription quantity when already correct', async function () {
            // Using `defaultteamprod` which has a quantity of 1 already
            app = await setup({
                billing: {
                    stripe: {
                        key: 1234,
                        team_product: 'defaultteamprod',
                        team_price: 'defaultteamprice'
                    }
                }
            })
            await app.billing.updateTeamMemberCount(app.team)
            should.not.exist(updateId)
            should.not.exist(updateData)
        })
        it('updates team subscription quantity when incorrect', async function () {
            // Using `starterteamprod` which has a quantity of 27
            app = await setup({
                billing: {
                    stripe: {
                        key: 1234,
                        team_product: 'defaultteamprod',
                        team_price: 'defaultteamprice',
                        teams: {
                            starter: {
                                product: 'starterteamprod',
                                price: 'starterteampprice'
                            }
                        }
                    }
                }
            })
            await app.billing.updateTeamMemberCount(app.team)
            should.exist(updateId)
            updateId.should.equal('234')
            should.exist(updateData)
            updateData.should.have.property('quantity', 1)
            updateData.should.have.property('proration_behavior', 'always_invoice')
        })
    })

    describe('updateTeamDeviceCount', async function () {
        let updateId, updateData
        describe('no existing subscription item', async function () {
            beforeEach(async function () {
                updateId = null
                updateData = null
                setupStripe({
                    subscriptions: {
                        retrieve: async sub => {
                            return { items: { data: [] } }
                        },
                        update: async (sub, update) => {
                            updateId = sub
                            updateData = update
                        }
                    }
                })
            })
            it('does not add team device item when billable count is 0', async function () {
                // app.team has no devices
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice',
                            device_product: 'defaultdeviceprod',
                            device_price: 'defaultdeviceprice'
                        }
                    }
                })
                await app.billing.updateTeamDeviceCount(app.team)
                should.not.exist(updateId)
                should.not.exist(updateData)
            })
            it('adds team device item when billable count is > 0', async function () {
                // Using `starterteamprod` which has a quantity of 27
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice',
                            device_product: 'defaultdeviceprod',
                            device_price: 'defaultdeviceprice',
                            teams: {
                                starter: {
                                    product: 'starterteamprod',
                                    price: 'starterteampprice'
                                }
                            }
                        }
                    }
                })
                const device = await app.db.models.Device.create({ name: 'd1', type: 'd1', credentialSecret: '' })
                await app.team.addDevice(device)

                await app.billing.updateTeamDeviceCount(app.team)
                should.exist(updateId)
                updateId.should.equal('sub_1234567890')
                should.exist(updateData)
                updateData.should.have.property('items')
                updateData.items.should.have.lengthOf(1)
                updateData.items[0].should.have.property('price', 'defaultdeviceprice')
                updateData.items[0].should.have.property('quantity', 1)
            })
        })
        describe('existing subscription item', async function () {
            beforeEach(async function () {
                updateId = null
                updateData = null
                const itemData = { id: '123', quantity: 27, plan: { product: 'defaultdeviceprod' } }
                setupStripe({
                    subscriptions: {
                        retrieve: async sub => {
                            return {
                                items: {
                                    data: [itemData]
                                }
                            }
                        }
                    },
                    subscriptionItems: {
                        update: async (id, update) => {
                            updateId = id
                            updateData = update
                            if (id === itemData.id) {
                                itemData.quantity = update.quantity
                            }
                        }
                    }
                })
            })
            it('updates device count to 0', async function () {
                // app.team has no devices
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice',
                            device_product: 'defaultdeviceprod',
                            device_price: 'defaultdeviceprice'
                        }
                    }
                })
                await app.billing.updateTeamDeviceCount(app.team)
                should.exist(updateId)
                updateId.should.equal('123')
                should.exist(updateData)
                updateData.should.have.property('quantity', 0)
                updateData.should.have.property('proration_behavior', 'always_invoice')
            })
            it('updates device count to 1', async function () {
                // app.team has no devices
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice',
                            device_product: 'defaultdeviceprod',
                            device_price: 'defaultdeviceprice'
                        }
                    }
                })
                const device = await app.db.models.Device.create({ name: 'd1', type: 'd1', credentialSecret: '' })
                await app.team.addDevice(device)

                await app.billing.updateTeamDeviceCount(app.team)
                should.exist(updateId)
                updateId.should.equal('123')
                should.exist(updateData)
                updateData.should.have.property('quantity', 1)
                updateData.should.have.property('proration_behavior', 'always_invoice')
            })
            it('includes free allocation when calculating billable device count', async function () {
                // app.team has no devices
                app = await setup({
                    billing: {
                        stripe: {
                            key: 1234,
                            team_product: 'defaultteamprod',
                            team_price: 'defaultteamprice',
                            device_product: 'defaultdeviceprod',
                            device_price: 'defaultdeviceprice'
                        }
                    }
                })

                const teamType = await app.db.models.TeamType.byName('starter')
                const properties = teamType.properties
                properties.deviceFreeAllocation = 2
                teamType.properties = properties
                await teamType.save()
                await app.team.reload({
                    include: [{ model: app.db.models.TeamType }]
                })

                const device = await app.db.models.Device.create({ name: 'd1', type: 'd1', credentialSecret: '' })
                await app.team.addDevice(device)

                // With a free allocation of 2, this first call should see the
                // count get changed from the starting point of 27 (setup in beforeEach)
                // back to 0 - even though there is a device in the team.
                await app.billing.updateTeamDeviceCount(app.team)
                should.exist(updateId)
                updateId.should.equal('123')
                should.exist(updateData)
                updateData.should.have.property('quantity', 0)
                updateData.should.have.property('proration_behavior', 'always_invoice')

                updateId = null
                updateData = null

                // Add a second device - still within free allocation
                const device2 = await app.db.models.Device.create({ name: 'd2', type: 'd1', credentialSecret: '' })
                await app.team.addDevice(device2)
                // No update should get made as we're still inside free allocation
                await app.billing.updateTeamDeviceCount(app.team)
                should.not.exist(updateId)
                should.not.exist(updateData)

                // Add a third device - exceeds free allocation
                const device3 = await app.db.models.Device.create({ name: 'd3', type: 'd1', credentialSecret: '' })
                await app.team.addDevice(device3)
                // Should update billing to 1 (3 devices, 2 are free)
                await app.billing.updateTeamDeviceCount(app.team)
                should.exist(updateId)
                updateId.should.equal('123')
                should.exist(updateData)
                updateData.should.have.property('quantity', 1)
                updateData.should.have.property('proration_behavior', 'always_invoice')
            })
        })
    })
})
