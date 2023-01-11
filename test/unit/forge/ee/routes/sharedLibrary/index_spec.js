const should = require('should')
const setup = require('../../setup')

describe('Storage API', function () {
    let app
    let tokens
    let project
    let project2
    let tokens2

    beforeEach(async function () {
        app = await setup()
        project = await app.db.models.Project.create({ name: 'project1', type: '', url: '' })
        await app.team.addProject(project)
        tokens = await project.refreshAuthTokens()
        project2 = await app.db.models.Project.create({ name: 'project2', type: '', url: '' })
        await app.team.addProject(project2)
        tokens2 = await project2.refreshAuthTokens()
    })

    afterEach(async function () {
        await app.close()
    })

    describe('/shared-library', function () {
        async function shouldRejectGet (url, token) {
            const response = await app.inject({
                method: 'GET',
                url,
                headers: {
                    authorization: `Bearer ${token}`
                }
            })
            response.statusCode.should.equal(404)
        }
        async function shouldRejectPost (url, token) {
            const response = await app.inject({
                method: 'POST',
                url,
                headers: {
                    authorization: `Bearer ${token}`
                },
                payload: { name: 'test', meta: {}, body: 'foo' }
            })
            response.statusCode.should.equal(404)
        }
        it('GET Rejects invalid token', async function () {
            return shouldRejectGet(`/storage/${project.id}/shared-library/${app.team.hashid}/functions`, tokens2.token)
        })
        it('GET Rejects invalid library id', async function () {
            return shouldRejectGet(`/storage/${project.id}/shared-library/invalid/functions`, tokens.token)
        })
        it('POST Rejects invalid token', async function () {
            return shouldRejectPost(`/storage/${project.id}/shared-library/${app.team.hashid}/functions`, tokens2.token)
        })
        it('POST Rejects invalid library id', async function () {
            return shouldRejectPost(`/storage/${project.id}/shared-library/invalid/functions`, tokens.token)
        })

        it('Add to Library', async function () {
            this.timeout(10000)
            const funcText = '\nreturn msg;'
            const libraryURL = `/storage/${project.id}/shared-library/${app.team.hashid}/functions`
            await app.inject({
                method: 'POST',
                url: libraryURL,
                payload: {
                    name: 'test',
                    meta: {},
                    body: funcText
                },
                headers: {
                    authorization: `Bearer ${tokens.token}`
                }
            })
            const response = await app.inject({
                method: 'GET',
                url: `${libraryURL}?name=test`,
                headers: {
                    authorization: `Bearer ${tokens.token}`
                }
            })
            const libraryEntry = response.payload
            should(libraryEntry).equal('\nreturn msg;')
        })

        it('Add to Library with path', async function () {
            const funcText = '\nreturn msg;'
            const libraryURL = `/storage/${project.id}/shared-library/${app.team.hashid}/functions`
            await app.inject({
                method: 'POST',
                url: libraryURL,
                payload: {
                    name: 'test/foo/bar',
                    meta: {},
                    body: funcText
                },
                headers: {
                    authorization: `Bearer ${tokens.token}`
                }
            })
            const response = await app.inject({
                method: 'GET',
                url: `${libraryURL}?name=test`,
                headers: {
                    authorization: `Bearer ${tokens.token}`
                }
            })
            const libraryEntry = response.json()
            should(libraryEntry).containDeep(['foo'])
        })

        it('Add to Library - access from another team project', async function () {
            this.timeout(10000)
            const funcText = '\nreturn msg;'
            const libraryURL = `/storage/${project.id}/shared-library/${app.team.hashid}/functions`
            await app.inject({
                method: 'POST',
                url: libraryURL,
                payload: {
                    name: 'test',
                    meta: {},
                    body: funcText
                },
                headers: {
                    authorization: `Bearer ${tokens.token}`
                }
            })

            // Now verify it exists in the context of Project2's end-point
            const libraryURL2 = `/storage/${project2.id}/shared-library/${app.team.hashid}/functions`
            const response = await app.inject({
                method: 'GET',
                url: `${libraryURL2}?name=test`,
                headers: {
                    authorization: `Bearer ${tokens2.token}`
                }
            })
            const libraryEntry = response.payload
            should(libraryEntry).equal('\nreturn msg;')
        })

        it('Add multiple entries to library', async function () {
            const funcText = '\nreturn msg;'
            const libraryURL = `/storage/${project.id}/shared-library/${app.team.hashid}/functions`

            async function addToLibrary (name) {
                return await app.inject({
                    method: 'POST',
                    url: libraryURL,
                    payload: {
                        name,
                        meta: { metaName: name },
                        body: funcText
                    },
                    headers: {
                        authorization: `Bearer ${tokens.token}`
                    }
                })
            }

            async function getFromLibrary (name) {
                return (await app.inject({
                    method: 'GET',
                    url: `${libraryURL}?name=${name}`,
                    headers: {
                        authorization: `Bearer ${tokens.token}`
                    }
                })).json()
            }
            /*
              Library file structure:
                ├── bar3
                └── test
                    └── foo
                        ├── bar
                        └── bar2
            */

            await addToLibrary('test/foo/bar')
            await addToLibrary('test/foo/bar2')
            await addToLibrary('bar3')

            const libraryEntry = await getFromLibrary('')
            libraryEntry.should.have.length(2)
            libraryEntry[0].should.have.property('fn', 'bar3')
            libraryEntry[0].should.have.property('metaName', 'bar3')
            libraryEntry[1].should.eql('test')

            const libraryEntry1 = await getFromLibrary('test')
            libraryEntry1.should.eql(['foo'])
            const libraryEntry2 = await getFromLibrary('test/foo')
            libraryEntry2.should.have.length(2)
            libraryEntry2[0].should.have.property('fn', 'bar')
            libraryEntry2[0].should.have.property('metaName', 'test/foo/bar')
            libraryEntry2[1].should.have.property('fn', 'bar2')
            libraryEntry2[1].should.have.property('metaName', 'test/foo/bar2')
        })
    })
})
